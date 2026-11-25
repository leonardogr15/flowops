import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { expect, test, type Page } from "@playwright/test";

/**
 * axe on the real, built application (nginx + API), desktop and mobile, including colour contrast.
 * Uses the axe-core package the unit tests already depend on; no extra dependency.
 */
const password = process.env.DEMO_PASSWORD ?? "";
// Evaluated through the DevTools protocol, so the app's CSP (no inline scripts) stays untouched.
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

test.beforeAll(() => {
  if (password.length < 12) throw new Error("Set DEMO_PASSWORD to the value used by `make demo`.");
});

interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[]; any: { data?: { contrastRatio?: number; fgColor?: string; bgColor?: string } }[] }[];
}

async function violations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  const found = await page.evaluate(async () => {
    // @ts-expect-error axe is injected above
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations as Violation[];
  });
  return found.map((v) => {
    const nodes = v.nodes.map((n) => {
      const c = n.any.find((check) => check.data?.contrastRatio)?.data;
      return n.target.join(" ") + (c ? ` [${c.fgColor} on ${c.bgColor}: ${c.contrastRatio}]` : "");
    });
    return `${v.id} (${v.impact}): ${v.help} -> ${nodes.join(", ")}`;
  });
}

test("the main pages have no axe violations, colour contrast included", async ({ page, context }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  const check = async (name: string) => problems.push(...(await violations(page)).map((v) => `${name}: ${v}`));
  await page.goto("/login");
  await check("login");

  await context.addInitScript(() => localStorage.setItem("flowops.activeOrganization", "orbital-supplies"));
  await page.getByLabel("Work email").fill("adam.admin@flowops.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview$/);

  const pages: [string, string | RegExp][] = [
    ["/overview", /Orbital Supplies/],
    ["/requests?scope=all", "Requests"],
    ["/inbox", "Inbox"],
    ["/workflows", "Workflows"],
    ["/members", "Members"],
    ["/audit", "Audit log"],
  ];
  for (const [path, heading] of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await check(path);
  }

  // A request detail page (route, decision panel or history, audit trail) and the workflow builder.
  await page.goto("/requests?scope=all");
  await page.getByRole("main").getByRole("link").filter({ hasText: /Laptop|chairs|Monitor|Conference/ }).first().click();
  await expect(page.getByRole("heading", { name: "Approval route" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await check("request detail");

  await page.goto("/workflows/new");
  await expect(page.getByRole("heading", { name: "Approval steps" })).toBeVisible();
  await check("workflow builder");
  expect(problems).toEqual([]);
});
