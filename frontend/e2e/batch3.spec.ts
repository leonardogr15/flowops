import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Requests and approvals against the composed stack seeded with `make demo`.
 * Seeded route for "Purchase over $1,000": Raj (named person) -> any admin or above -> any owner.
 * Every test creates its own requests, so desktop and mobile projects can run side by side.
 */
const password = process.env.DEMO_PASSWORD ?? "";
const WORKFLOW = "Purchase over $1,000";

// Each scenario signs in three or four people in separate browser contexts; 30 s is too tight
// for that much real work, not a way to hide waiting on flaky state.
test.describe.configure({ timeout: 90_000 });

test.beforeAll(() => {
  if (password.length < 12) throw new Error("Set DEMO_PASSWORD to the value used by `make demo`.");
});

// Every scenario opens one browser context per person; they are closed after each test (TC-03).
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

async function as(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ ...test.info().project.use });
  contexts.push(context);
  // Raj also belongs to another organization; all scenarios happen in Orbital Supplies.
  await context.addInitScript(() => localStorage.setItem("flowops.activeOrganization", "orbital-supplies"));
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  return page;
}

/** Maya creates a draft and submits it; returns the request URL. */
async function submitRequest(page: Page, title: string, amount = "1890.00"): Promise<string> {
  await page.goto("/requests/new");
  await page.getByLabel("Workflow").selectOption({ label: WORKFLOW });
  await page.getByLabel("Title").fill(title);
  await page.getByLabel(/Details/).fill("Created by the end-to-end suite.");
  await page.getByLabel("Amount", { exact: true }).fill(amount);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("In review", { exact: true }).first()).toBeVisible();
  return new URL(page.url()).pathname;
}

async function approve(page: Page, path: string, step: number, comment = "") {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: `Your decision on step ${step}` })).toBeVisible();
  if (comment) await page.getByRole("textbox", { name: /^Comment/ }).fill(comment);
  await page.getByRole("button", { name: `Approve step ${step}` }).click();
  await expect(page.getByRole("heading", { name: `Your decision on step ${step}`, exact: true })).toBeHidden();
}

function stamp(): string {
  return `${test.info().project.name}-${Date.now()}`;
}

test("Maya's request goes through Raj, Adam and Olivia, and the whole trail is recorded", async ({ browser }) => {
  const title = `Monitor arms ${stamp()}`;
  const maya = await as(browser, "maya.member@flowops.test");
  const path = await submitRequest(maya, title);

  // Maya is the requester: she sees the route but never a decision panel.
  await expect(maya.getByRole("heading", { name: /Your decision/ })).toHaveCount(0);

  const raj = await as(browser, "raj.approver@flowops.test");
  await raj.goto("/inbox");
  await raj.getByRole("link", { name: new RegExp(title) }).click();
  await expect(raj).toHaveURL(new RegExp(`${path}$`));
  await approve(raj, path, 1, "Team needs them for the new desks.");

  const adam = await as(browser, "adam.admin@flowops.test");
  await adam.goto("/inbox");
  await expect(adam.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await approve(adam, path, 2);

  const olivia = await as(browser, "olivia.owner@flowops.test");
  await approve(olivia, path, 3);
  await expect(olivia.getByText("Approved", { exact: true }).first()).toBeVisible();

  // Maya is told, and the audit trail lists every step in order with who decided it.
  await maya.reload();
  await expect(maya.getByText("Approved", { exact: true }).first()).toBeVisible();
  const trail = maya.getByRole("complementary", { name: "Audit trail" });
  await expect(trail.getByText("Created the draft")).toBeVisible();
  await expect(trail.getByText(/Submitted for approval \(workflow version \d+\)/)).toBeVisible();
  await expect(trail.getByText("Approved step 1, Team lead approval")).toBeVisible();
  await expect(trail.getByText("Approved step 2, Finance review")).toBeVisible();
  await expect(trail.getByText("Approved step 3, Owner sign-off")).toBeVisible();
  await expect(trail.getByText("Request approved")).toBeVisible();
  for (const email of ["raj.approver", "adam.admin", "olivia.owner"]) {
    await expect(trail.getByText(new RegExp(`^${email}@flowops\\.test,`)).first()).toBeVisible();
  }
  await expect(maya.getByText("Team needs them for the new desks.")).toBeVisible();

  const bell = maya.getByRole("button", { name: /^Notifications/ });
  await bell.click();
  await expect(maya.getByRole("menuitem", { name: new RegExp(`Your request was approved.*${title}`) })).toBeVisible();
  await maya.keyboard.press("Escape");

  // The organization-wide audit log is for admins only.
  await olivia.goto("/audit");
  await olivia.getByLabel("Area").selectOption({ label: "Approval decisions" });
  await olivia.getByRole("button", { name: "Apply filters" }).click();
  await expect(olivia.getByRole("cell", { name: "task.approved" }).first()).toBeVisible();
  await maya.goto("/audit");
  await expect(maya.getByRole("heading", { name: "Only admins can see the audit log" })).toBeVisible();
});

test("a rejection needs a reason, ends the request, and it can be duplicated", async ({ browser }) => {
  const title = `Conference trip ${stamp()}`;
  const maya = await as(browser, "maya.member@flowops.test");
  const path = await submitRequest(maya, title, "2400.00");

  const raj = await as(browser, "raj.approver@flowops.test");
  await raj.goto(path);
  await raj.getByRole("button", { name: "Reject request" }).click();
  await expect(raj.getByRole("alert")).toHaveText("Add a comment explaining the rejection.");
  await raj.getByRole("textbox", { name: /^Comment/ }).fill("Budget for travel is frozen this quarter.");
  await raj.getByRole("button", { name: "Reject request" }).click();
  await expect(raj.getByText("Rejected", { exact: true }).first()).toBeVisible();

  await maya.reload();
  await expect(maya.getByText("Rejected", { exact: true }).first()).toBeVisible();
  await expect(maya.getByText("Budget for travel is frozen this quarter.").first()).toBeVisible();
  await expect(maya.getByRole("complementary", { name: "Audit trail" }).getByText("Rejected step 1, Team lead approval")).toBeVisible();
  await maya.getByRole("button", { name: "Duplicate as new draft" }).click();
  await expect(maya).not.toHaveURL(new RegExp(`${path}$`));
  await expect(maya.getByRole("heading", { name: title })).toBeVisible();
  await expect(maya.getByText("Draft", { exact: true })).toBeVisible();
});

test("nobody can approve their own request, not even an admin", async ({ browser }) => {
  const title = `Admin's own laptop ${stamp()}`;
  const adam = await as(browser, "adam.admin@flowops.test");
  const path = await submitRequest(adam, title);
  const id = path.split("/").pop()!;

  await approve(await as(browser, "raj.approver@flowops.test"), path, 1);

  // Step 2 is "any admin or above": Adam qualifies by role but is the requester.
  await adam.goto(path);
  await expect(adam.getByText("Step 2 of 3").or(adam.getByText(/Finance review/)).first()).toBeVisible();
  await expect(adam.getByRole("heading", { name: /Your decision/ })).toHaveCount(0);
  await adam.goto("/inbox");
  await expect(adam.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);

  // Calling the API directly is refused too.
  const status = await adam.evaluate(async (requestId) => {
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("csrftoken="))?.split("=")[1] ?? "";
    const response = await fetch(`/api/v1/org/requests/${requestId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf, "X-Organization": "orbital-supplies" },
      body: JSON.stringify({ step: 2, comment: "" }),
    });
    return response.status;
  }, id);
  expect(status).toBe(403);

  const olivia = await as(browser, "olivia.owner@flowops.test");
  await approve(olivia, path, 2);
  await expect(olivia.getByRole("heading", { name: "Your decision on step 3" })).toBeVisible();
});

test("when two admins decide the same step at once, exactly one decision counts", async ({ browser }) => {
  const title = `Shared licences ${stamp()}`;
  const maya = await as(browser, "maya.member@flowops.test");
  const path = await submitRequest(maya, title);
  await approve(await as(browser, "raj.approver@flowops.test"), path, 1);

  const adam = await as(browser, "adam.admin@flowops.test");
  const olivia = await as(browser, "olivia.owner@flowops.test");
  await Promise.all([adam.goto(path), olivia.goto(path)]);
  await expect(adam.getByRole("button", { name: "Approve step 2" })).toBeVisible();
  await expect(olivia.getByRole("button", { name: "Reject request" })).toBeVisible();
  await olivia.getByRole("textbox", { name: /^Comment/ }).fill("Not this quarter.");

  await Promise.all([
    adam.getByRole("button", { name: "Approve step 2" }).click(),
    olivia.getByRole("button", { name: "Reject request" }).click(),
  ]);

  // One wins; the other is told someone else decided first, and sees the refreshed request.
  await expect
    .poll(async () => {
      const lost = await Promise.all(
        [adam, olivia].map((p) => p.getByText("Someone else decided this step first.").isVisible()),
      );
      return lost.filter(Boolean).length;
    })
    .toBe(1);

  await maya.reload();
  const trail = maya.getByRole("complementary", { name: "Audit trail" });
  const step2 = trail.getByText(/^(Approved|Rejected) step 2, Finance review$/);
  await expect(step2).toHaveCount(1);
});
