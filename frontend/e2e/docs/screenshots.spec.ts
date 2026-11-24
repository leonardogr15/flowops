import { devices, expect, test, type Browser, type Page } from "@playwright/test";

/**
 * README screenshots (make screenshots). Runs against the seeded end-to-end stack: every name,
 * organization and amount is synthetic demo data. The sign-in form is never captured filled in.
 */
const password = process.env.DEMO_PASSWORD ?? "";
const OUT = "../docs/images";

test.beforeAll(() => {
  if (password.length < 12) throw new Error("Set DEMO_PASSWORD to the value used by `make demo`.");
});

async function signIn(browser: Browser, email: string, mobile = false): Promise<Page> {
  const context = await browser.newContext(
    mobile ? { ...devices["Pixel 7"], deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } },
  );
  await context.addInitScript(() => localStorage.setItem("flowops.activeOrganization", "orbital-supplies"));
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  return page;
}

async function submitAsMaya(page: Page, title: string, amount: string, details: string) {
  await page.goto("/requests/new");
  await page.getByLabel("Workflow").selectOption({ label: "Purchase over $1,000" });
  await page.getByLabel("Title").fill(title);
  await page.getByLabel(/Details/).fill(details);
  await page.getByLabel("Amount", { exact: true }).fill(amount);
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("In review", { exact: true }).first()).toBeVisible();
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

// Requests waiting for Raj (step 1) when the inbox is captured. Enough of them that every notice
// visible in the open notifications menu is about a step that is still pending.
const WAITING_FOR_RAJ: [string, string, string][] = [
  ["Standing desks for the support team", "3180.00", "Six height-adjustable desks for the new support pod."],
  ["Design tool licences for 2027", "2400.00", "Renewal of eight annual seats for the design team."],
  ["Replacement monitors for finance", "1980.00", "Four 27-inch monitors to replace units out of warranty."],
  ["Usability testing panel, Q1", "4500.00", "Recruiting and incentives for twelve research sessions."],
  ["Cloud backup storage upgrade", "1320.00", "Raise the backup quota to 20 TB for the next year."],
  ["Onboarding laptops for two hires", "2900.00", "Two standard laptops for the January starters."],
  ["Team offsite venue deposit", "1750.00", "Deposit for the March planning offsite."],
];

test("README screenshots", async ({ browser }) => {

  // 1. Request detail: decision panel, approval route and audit trail (Adam, step 2).
  const adam = await signIn(browser, "adam.admin@flowops.test");
  await adam.goto("/inbox");
  await adam.getByRole("link", { name: /Ergonomic chairs/ }).click();
  await expect(adam.getByRole("heading", { name: "Your decision on step 2" })).toBeVisible();
  await settle(adam);
  await adam.screenshot({ path: `${OUT}/request-detail.png` });

  // 2. Workflow builder with the live route preview (Adam).
  await adam.goto("/workflows");
  await adam.getByRole("link", { name: /Purchase over \$1,000/ }).click();
  await expect(adam.getByRole("heading", { name: "Approval steps" })).toBeVisible();
  await settle(adam);
  await adam.screenshot({ path: `${OUT}/workflow-builder.png` });

  // 3. Organization audit log (Adam is an admin).
  await adam.goto("/audit");
  await expect(adam.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
  await settle(adam);
  await adam.screenshot({ path: `${OUT}/audit-log.png` });

  // 4. Mobile: the same request on a phone (Adam), above the fold.
  const phone = await signIn(browser, "adam.admin@flowops.test", true);
  await phone.goto("/inbox");
  await phone.getByRole("link", { name: /Ergonomic chairs/ }).click();
  await expect(phone.getByRole("heading", { name: "Your decision on step 2" })).toBeVisible();
  await settle(phone);
  await phone.screenshot({ path: `${OUT}/mobile-request.png` });

  // Raj's inbox last, so the other captures (audit log included) show only the seeded history.
  const maya = await signIn(browser, "maya.member@flowops.test");
  for (const [title, amount, details] of WAITING_FOR_RAJ) await submitAsMaya(maya, title, amount, details);

  // 5. Inbox with the notifications menu open (Raj, step 1 approver).
  const raj = await signIn(browser, "raj.approver@flowops.test");
  await raj.goto("/inbox");
  const waiting = WAITING_FOR_RAJ.map(([title]) => title);
  for (const title of waiting) await expect(raj.getByRole("link", { name: title })).toBeVisible();
  // Raj has already seen the notices about requests decided earlier (read state), like a real user.
  await raj.evaluate(async (pending) => {
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("csrftoken="))?.split("=")[1] ?? "";
    const headers = { "X-Organization": "orbital-supplies", "X-CSRFToken": csrf };
    const list = await (await fetch("/api/v1/org/notifications?page_size=50", { headers })).json();
    for (const n of list.results as { id: string; request_title: string }[]) {
      if (!pending.includes(n.request_title)) {
        await fetch(`/api/v1/org/notifications/${n.id}/read`, { method: "POST", headers });
      }
    }
  }, waiting);
  await raj.reload();
  await expect(raj.getByRole("link", { name: waiting[0] })).toBeVisible();
  await raj.getByRole("button", { name: /^Notifications/ }).filter({ visible: true }).first().click();
  const menu = raj.getByRole("menu");
  await expect(menu).toBeVisible();
  await settle(raj);
  // Notifications are a history (README, Known limitations): older notices about steps that were
  // decided long ago keep their wording. The capture must only show notices for pending steps, so
  // check every item that is at least partly visible inside the menu.
  const visibleTitles = await menu.evaluate((root) => {
    const box = root.getBoundingClientRect();
    return [...root.querySelectorAll<HTMLElement>("[role=menuitem]")]
      .filter((item) => {
        const r = item.getBoundingClientRect();
        return r.bottom > box.top && r.top < box.bottom;
      })
      .map((item) => item.innerText);
  });
  expect(visibleTitles.length).toBeGreaterThan(0);
  for (const text of visibleTitles) {
    expect(text).toContain("Needs your decision");
    expect(waiting.some((title) => text.includes(title.slice(0, 24)))).toBe(true);
  }
  await raj.screenshot({ path: `${OUT}/inbox-and-notifications.png` });
});
