import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { ADAM, db } from "../test/server";
import { renderApp } from "../test/render";

async function signIn(password = "right-password") {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Work email"), ADAM.email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  return user;
}

describe("authentication", () => {
  it("redirects anonymous visitors to the sign-in page", async () => {
    const { router } = renderApp("/members");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("validates the form before calling the API", async () => {
    renderApp("/login");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your work email.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toHaveAttribute("aria-invalid", "true");
    expect(db.sessionUser).toBeNull();
  });

  it("shows one generic message for wrong credentials", async () => {
    renderApp("/login");
    await signIn("wrong-password");
    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password don't match an account.");
  });

  it("signs in with CSRF, lands on the overview of the active organization, and signs out", async () => {
    const { router } = renderApp("/login");
    const user = await signIn();
    expect(await screen.findByRole("heading", { level: 1, name: "Orbital Supplies Co." })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/overview");
    expect(db.orgRequests).toContain("orbital-supplies");

    await user.click(screen.getAllByRole("button", { name: "Sign out" })[0]!);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(db.sessionUser).toBeNull();
  });

  it("returns to the page the visitor originally asked for", async () => {
    const { router } = renderApp("/members");
    await signIn();
    await screen.findByRole("heading", { name: "Members" });
    expect(router.state.location.pathname).toBe("/members");
  });
});

describe("organizations", () => {
  it("sends the selected organization on tenant requests when switching", async () => {
    db.sessionUser = ADAM;
    renderApp("/members");
    expect(await screen.findByText("Owner of orbital-supplies")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: /switch organization/i })[0]!);
    await user.click(await screen.findByRole("menuitem", { name: /Kestrel Analytics/ }));

    expect(await screen.findByText("Owner of kestrel-analytics")).toBeInTheDocument();
    expect(db.orgRequests.at(-1)).toBe("kestrel-analytics");
    expect(localStorage.getItem("flowops.activeOrganization")).toBe("kestrel-analytics");
  });

  it("ignores a stored organization the user no longer belongs to", async () => {
    db.sessionUser = ADAM;
    localStorage.setItem("flowops.activeOrganization", "someone-elses-org");
    renderApp("/overview");
    expect(await screen.findByRole("heading", { level: 1, name: "Orbital Supplies Co." })).toBeInTheDocument();
    expect(db.orgRequests).not.toContain("someone-elses-org");
  });

  it("lets admins rename the organization and confirms the save", async () => {
    db.sessionUser = ADAM;
    renderApp("/settings");
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Organization name");
    await user.clear(field);
    await user.type(field, "Orbital Supplies");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
  });

  it("shows members a clear permission message instead of the settings form", async () => {
    db.sessionUser = ADAM;
    db.memberships = { "kestrel-analytics": "member" };
    renderApp("/settings");
    expect(await screen.findByText("Only admins can change organization settings")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("offers to create an organization when the user has none", async () => {
    db.sessionUser = ADAM;
    db.memberships = {};
    renderApp("/overview");
    expect(await screen.findByRole("heading", { name: "You're not in an organization yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create an organization" })).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("sign-in page has no axe violations", async () => {
    const { container } = renderApp("/login");
    await screen.findByRole("heading", { name: "Sign in" });
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } }); // jsdom has no layout
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("members page has no axe violations", async () => {
    db.sessionUser = ADAM;
    const { container } = renderApp("/members");
    await screen.findByText("Owner of orbital-supplies");
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
