import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/**
 * Records the approval flow for the README GIF and the MP4 (make demo-gif). One browser session
 * that signs in as each person in turn, so the recording is continuous. The caption bar is drawn
 * by this script for the recording only; it is not part of the application.
 */
const password = process.env.DEMO_PASSWORD ?? "";
const OUT = "docs-output";
const TITLE = "Noise-cancelling headsets for the support team";
let requestPath = ""; // the request created in this recording (earlier runs may have left others)

test.beforeAll(() => {
  if (password.length < 12) throw new Error("Set DEMO_PASSWORD to the value used by `make demo`.");
  mkdirSync(OUT, { recursive: true });
});

/**
 * A narrow band across the top of the recording, in the brand accent with a "Demo" label: clearly
 * not part of the app (whose notices are dark and bottom-right), and it covers no content.
 */
async function caption(page: Page, text: string) {
  await page.evaluate((value) => {
    let bar = document.getElementById("demo-caption");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "demo-caption";
      Object.assign(bar.style, {
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        zIndex: "9999",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        height: "30px",
        background: "#2d5be3", // --color-signal
        color: "#ffffff",
        font: "600 15px/1 system-ui, sans-serif",
        pointerEvents: "none",
      });
      const tag = document.createElement("span");
      tag.textContent = "Demo";
      Object.assign(tag.style, {
        padding: "3px 7px",
        borderRadius: "4px",
        background: "rgba(255,255,255,.22)",
        font: "700 11px/1 system-ui, sans-serif",
        letterSpacing: "0.04em",
      });
      const label = document.createElement("span");
      label.id = "demo-caption-text";
      bar.append(tag, label);
      document.body.appendChild(bar);
    }
    document.getElementById("demo-caption-text")!.textContent = value;
  }, text);
}

async function pause(page: Page, ms = 1200) {
  await page.waitForTimeout(ms);
}

async function signInAs(page: Page, email: string, text: string, onScreen?: () => void) {
  await page.goto("/login");
  await caption(page, text);
  onScreen?.();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await caption(page, text);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function approveFromInbox(page: Page, step: number, text: string) {
  await page.getByRole("link", { name: /^Inbox/ }).click();
  await caption(page, text);
  await pause(page, 900);
  await page.locator(`main a[href="${requestPath}"]`).click();
  await expect(page.getByRole("heading", { name: `Your decision on step ${step}` })).toBeVisible();
  await caption(page, text);
  await pause(page);
  await page.getByRole("button", { name: `Approve step ${step}` }).click();
  await expect(page.getByRole("heading", { name: `Your decision on step ${step}` })).toBeHidden();
  await pause(page);
}

test("approval flow recording", async ({ browser }) => {
  // Native 1080p frames. Playwright records at the viewport size without scaling, so the page is
  // shown at 150% zoom (as a person with browser zoom at 150% would see it): a 1280x720 layout,
  // rendered sharply at 1920x1080.
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: `${OUT}/raw`, size: { width: 1920, height: 1080 } },
  });
  await context.addInitScript(() => {
    localStorage.setItem("flowops.activeOrganization", "orbital-supplies");
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.style.zoom = "1.5";
    });
  });
  const page = await context.newPage();
  const recordingStarted = Date.now();

  // The recording starts on a blank page: make_demo_media.sh trims everything before the first
  // captioned screen, using the offset written here.
  await signInAs(page, "maya.member@flowops.test", "Maya creates a purchase request", () =>
    writeFileSync(`${OUT}/approval-flow.start`, ((Date.now() - recordingStarted) / 1000).toFixed(2)),
  );
  await page.goto("/requests/new");
  await caption(page, "Maya creates a purchase request");
  await page.getByLabel("Workflow").selectOption({ label: "Purchase over $1,000" });
  await page.getByLabel("Title").fill(TITLE);
  await page.getByLabel("Amount", { exact: true }).fill("1640.00");
  await pause(page, 700);
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("In review", { exact: true }).first()).toBeVisible();
  requestPath = new URL(page.url()).pathname;
  await caption(page, "Submitted: it now follows Raj → any admin → any owner");
  await pause(page, 1800);
  await signOut(page);

  await signInAs(page, "raj.approver@flowops.test", "Raj (team lead) approves step 1");
  await approveFromInbox(page, 1, "Raj (team lead) approves step 1");
  await signOut(page);

  await signInAs(page, "adam.admin@flowops.test", "Adam (admin) approves step 2");
  await approveFromInbox(page, 2, "Adam (admin) approves step 2");
  await signOut(page);

  await signInAs(page, "olivia.owner@flowops.test", "Olivia (owner) gives the final sign-off");
  await approveFromInbox(page, 3, "Olivia (owner) gives the final sign-off");
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await signOut(page);

  await signInAs(page, "maya.member@flowops.test", "Maya sees the decision and the audit trail");
  await page.goto("/requests");
  await page.locator(`main a[href="${requestPath}"]`).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await caption(page, "Approved, with every decision recorded in order");
  await pause(page, 2600);

  const video = page.video();
  await context.close();
  await video?.saveAs(`${OUT}/approval-flow.webm`);
});
