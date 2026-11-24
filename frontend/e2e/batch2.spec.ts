import { expect, test, type Page } from "@playwright/test";

/** Runs against the composed stack seeded with `make demo` (see README). */
const password = process.env.DEMO_PASSWORD ?? "";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview$/);
}

test.beforeAll(() => {
  if (password.length < 12) throw new Error("Set DEMO_PASSWORD to the value used by `make demo`.");
});

test("an admin invites a new person, who creates an account and joins", async ({ page, browser }, testInfo) => {
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const email = `e2e.${stamp}@flowops.test`;
  const fullName = `Nina ${stamp}`;
  await signIn(page, "adam.admin@flowops.test");
  await page.goto("/members");
  await page.getByRole("button", { name: "Invite people" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send invitation" }).click();
  const link = await page.getByLabel("Invitation link").textContent();
  const invitePath = new URL(link ?? "").pathname; // the API builds links for the public host
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(email)).toBeVisible(); // pending invitation

  const guest = await browser.newContext({ baseURL: testInfo.project.use.baseURL, ...testInfo.project.use });
  const newcomer = await guest.newPage();
  await newcomer.goto(invitePath);
  await expect(newcomer.getByRole("heading", { name: "Join Orbital Supplies Co." })).toBeVisible();
  await newcomer.getByLabel("Your name").fill(fullName);
  await newcomer.getByLabel("Create a password").fill("a-long-enough-e2e-passphrase");
  await newcomer.getByRole("button", { name: "Create account and join" }).click();
  await expect(newcomer).toHaveURL(/\/overview$/);
  await expect(newcomer.getByRole("heading", { level: 1, name: "Orbital Supplies Co." })).toBeVisible();

  await newcomer.goto(invitePath); // single use
  await expect(newcomer.getByRole("heading", { name: "This invitation link doesn't work" })).toBeVisible();
  await guest.close();

  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: email })).toContainText(fullName);
});

test("an admin builds and publishes a workflow that members can view", async ({ page, browser }, testInfo) => {
  const name = `E2E route ${testInfo.project.name} ${Date.now()}`;
  await signIn(page, "adam.admin@flowops.test");
  await page.goto("/workflows/new");
  await page.getByLabel("Workflow name").fill(name);
  await page.getByLabel("Step 1 name").fill("Finance review");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Step 2 name").fill("Manager approval");
  await page.getByText("A specific person").nth(1).click();
  await page.getByLabel("Person who approves step 2").selectOption({ label: "Raj Approver (member)" });
  await page.getByRole("button", { name: "Move step 2 up" }).click();
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);
  const url = page.url();

  await page.getByRole("button", { name: "Publish version 1" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish version 1" }).click();
  await expect(page.getByText("Version 1 is live.")).toBeVisible();

  const memberContext = await browser.newContext({ ...testInfo.project.use });
  const member = await memberContext.newPage();
  await signIn(member, "maya.member@flowops.test");
  await member.goto(new URL(url).pathname);
  const route = member.getByRole("figure", { name: "Preview of the approval route" });
  await expect(route.getByRole("listitem").first()).toContainText("Manager approval");
  await expect(route.getByRole("listitem").first()).toContainText("Raj Approver");
  await expect(member.getByRole("button", { name: /Publish|Save draft/ })).toHaveCount(0);
  await memberContext.close();
});
