import { expect, test } from "@playwright/test";

/** Runs against the composed stack seeded with `make demo` (see README). */
const password = process.env.DEMO_PASSWORD ?? "";

test.beforeAll(() => {
  if (password.length < 12) throw new Error("Set DEMO_PASSWORD to the value used by `make demo`.");
});

test("an admin signs in, sees their organization and members, and signs out", async ({ page, isMobile }) => {
  await page.goto("/members");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Work email").fill("adam.admin@flowops.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/members$/);
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Olivia Owner/ })).toBeVisible();

  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Sign out" }).last().click();
  await expect(page).toHaveURL(/\/login$/);
});

test("wrong credentials show a single generic error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("adam.admin@flowops.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That email and password don't match an account.");
});
