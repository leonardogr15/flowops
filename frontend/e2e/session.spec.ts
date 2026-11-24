import { expect, test } from "@playwright/test";

/** FE-01: a session that ends on the server sends the person to sign in, then back where they were. */
const password = process.env.DEMO_PASSWORD ?? "";

test.beforeAll(() => {
  if (password.length < 12) throw new Error("Set DEMO_PASSWORD to the value used by `make demo`.");
});

test("an expired session returns to the login page and then to the same page", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("flowops.activeOrganization", "orbital-supplies"));
  await page.goto("/login");
  await page.getByLabel("Work email").fill("maya.member@flowops.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.goto("/requests");
  await expect(page.getByRole("heading", { name: "Requests", level: 1 })).toBeVisible();

  // The server no longer recognises the browser (expired or revoked session). The next API call
  // (here: opening the notifications, available on desktop and mobile) must end the session in the UI.
  await context.clearCookies({ name: "sessionid" });
  await page.getByRole("button", { name: /^Notifications/ }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Your session ended. Sign in again to continue where you left off.")).toBeVisible();

  await page.getByLabel("Work email").fill("maya.member@flowops.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByRole("heading", { name: "Requests", level: 1 })).toBeVisible();
});
