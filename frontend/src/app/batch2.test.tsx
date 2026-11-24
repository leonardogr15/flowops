import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { Member, TemplateDetail } from "../api/client";
import { renderApp } from "../test/render";
import { ADAM, db, server } from "../test/server";

const problem = (status: number, detail: string, extra: object = {}) =>
  HttpResponse.json({ type: "urn:flowops:problem:x", title: "Error", status, detail, instance: "/", ...extra }, { status });

const member = (id: string, name: string, role: Member["role"]): Member => ({
  id,
  role,
  user: { id: `u-${id}`, email: `${name.toLowerCase().replace(" ", ".")}@flowops.test`, full_name: name, date_joined: "2026-11-01T10:00:00Z" },
  created_at: "2026-11-01T10:00:00Z",
});

const MEMBERS: Member[] = [
  { ...member("m-adam", "Adam Admin", "admin"), user: ADAM },
  member("m-maya", "Maya Member", "member"),
  member("m-olivia", "Olivia Owner", "owner"),
];

function useMembers(list: Member[] = MEMBERS) {
  server.use(
    http.get("/api/v1/org/members", () => HttpResponse.json({ next: null, previous: null, results: list })),
    http.get("/api/v1/org/invitations", () => HttpResponse.json([])),
  );
}

async function noAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

describe("members and roles", () => {
  it("lets admins change a role and confirms it", async () => {
    db.sessionUser = ADAM;
    useMembers();
    const seen: { body: unknown; org: string | null }[] = [];
    server.use(
      http.patch("/api/v1/org/members/:id", async ({ request }) => {
        seen.push({ body: await request.json(), org: request.headers.get("X-Organization") });
        return HttpResponse.json(member("m-maya", "Maya Member", "admin"));
      }),
    );
    const { container } = renderApp("/members");
    const user = userEvent.setup();
    const select = await screen.findByLabelText("Role of Maya Member");
    // Admins cannot assign or change owners: no owner option, and the owner row is read-only.
    expect(within(select).queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Role of Olivia Owner")).not.toBeInTheDocument();

    await user.selectOptions(select, "admin");
    expect(await screen.findByText("Maya Member is now admin")).toBeInTheDocument();
    expect(seen).toEqual([{ body: { role: "admin" }, org: "orbital-supplies" }]);
    await noAxeViolations(container);
  });

  it("shows members read-only roles and no invite button", async () => {
    db.sessionUser = ADAM;
    db.memberships = { "kestrel-analytics": "member" };
    useMembers([member("m-me", "Adam Admin", "member"), member("m-x", "Kim Owner", "owner")]);
    renderApp("/members");
    expect(await screen.findByText("Kim Owner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Invite people/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("explains why the last owner cannot be removed", async () => {
    db.sessionUser = ADAM;
    db.memberships = { "orbital-supplies": "owner" };
    server.use(
      http.get("/api/v1/org/members", () =>
        HttpResponse.json({ next: null, previous: null, results: [{ ...member("m-adam", "Adam Admin", "owner"), user: ADAM }] }),
      ),
      http.delete("/api/v1/org/members/:id", () =>
        problem(409, "An organization needs at least one owner. Make someone else an owner first."),
      ),
    );
    renderApp("/members");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Leave organization" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Leave organization" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("needs at least one owner");
  });
});

describe("invitations", () => {
  it("validates the email, sends the invitation and shows the one-time link", async () => {
    db.sessionUser = ADAM;
    useMembers();
    const bodies: unknown[] = [];
    server.use(
      http.post("/api/v1/org/invitations", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          {
            id: "i1",
            email: "nina@flowops.test",
            role: "member",
            invited_by: "Adam Admin",
            expires_at: "2026-12-01T00:00:00Z",
            created_at: "2026-11-24T00:00:00Z",
            accept_url: "http://localhost:8080/invite/one-time-token",
          },
          { status: 201 },
        );
      }),
    );
    renderApp("/members");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Invite people/ }));
    const email = await screen.findByLabelText("Email");
    expect(email).toHaveFocus(); // dialogs start on the first field
    await user.type(email, "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(screen.getByText("Enter an email address like name@company.com.")).toBeInTheDocument();
    expect(bodies).toEqual([]);

    await user.clear(email);
    await user.type(email, "nina@flowops.test");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("heading", { name: "Invitation sent" })).toBeInTheDocument();
    expect(screen.getByLabelText("Invitation link")).toHaveTextContent("http://localhost:8080/invite/one-time-token");
    expect(bodies).toEqual([{ email: "nina@flowops.test", role: "member" }]);
  });

  it("tells visitors when a link no longer works", async () => {
    server.use(http.get("/api/v1/invitations/:token", () => problem(404, "This invitation link is invalid or has expired.")));
    renderApp("/invite/expired-token");
    expect(await screen.findByRole("heading", { name: "This invitation link doesn't work" })).toBeInTheDocument();
  });

  it("lets a new person create an account and join", async () => {
    const preview = {
      organization_name: "Orbital Supplies Co.",
      email: "nina@flowops.test",
      role: "member",
      invited_by: "Adam Admin",
      expires_at: "2026-12-01T00:00:00Z",
      account_exists: false,
    };
    const accepted: unknown[] = [];
    server.use(
      http.get("/api/v1/invitations/:token", () => HttpResponse.json(preview)),
      http.post("/api/v1/invitations/:token/accept", async ({ request, params }) => {
        accepted.push({ token: params.token, body: await request.json(), csrf: request.headers.get("X-CSRFToken") });
        db.sessionUser = { ...ADAM, email: "nina@flowops.test", full_name: "Nina Newhire" };
        return HttpResponse.json(
          { id: "m9", role: "member", organization: { id: "o1", name: "Orbital Supplies Co.", slug: "orbital-supplies", created_at: "2026-11-01T10:00:00Z" }, created_at: "2026-11-24T00:00:00Z", user: db.sessionUser },
          { status: 201 },
        );
      }),
    );
    const { router, container } = renderApp("/invite/good-token");
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Join Orbital Supplies Co." })).toBeInTheDocument();
    await noAxeViolations(container);

    await user.click(screen.getByRole("button", { name: "Create account and join" }));
    expect(screen.getByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 12 characters.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Your name"), "Nina Newhire");
    await user.type(screen.getByLabelText("Create a password"), "a-long-enough-passphrase");
    await user.click(screen.getByRole("button", { name: "Create account and join" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/overview"));
    expect(accepted).toEqual([
      { token: "good-token", body: { full_name: "Nina Newhire", password: "a-long-enough-passphrase" }, csrf: "test-csrf" },
    ]);
  });

  it("asks people with an existing account to sign in first", async () => {
    server.use(
      http.get("/api/v1/invitations/:token", () =>
        HttpResponse.json({ organization_name: "Orbital", email: "raj@flowops.test", role: "admin", invited_by: null, expires_at: "2026-12-01T00:00:00Z", account_exists: true }),
      ),
    );
    renderApp("/invite/tok");
    expect(await screen.findByRole("link", { name: "Sign in to accept" })).toHaveAttribute("href", "/login");
  });
});

const TEMPLATE: TemplateDetail = {
  id: "t1",
  name: "Purchase over $1,000",
  category: "purchase",
  description: "",
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
  published: null,
  draft: {
    id: "v1",
    number: 1,
    status: "draft",
    published_at: null,
    published_by: null,
    updated_at: "2026-11-01T10:00:00Z",
    steps: [{ id: "s1", order: 1, name: "Finance review", approver_type: "role", approver_user: null, approver_role: "admin" }],
  },
  history: [{ number: 1, status: "draft", published_at: null }],
};

describe("workflow templates", () => {
  it("lists drafts for admins and offers to create one", async () => {
    db.sessionUser = ADAM;
    useMembers();
    server.use(
      http.get("/api/v1/org/workflow-templates", () =>
        HttpResponse.json([{ id: "t1", name: "Purchase over $1,000", category: "purchase", description: "", published_version: null, published_step_count: 0, has_draft: true, updated_at: "2026-11-01T10:00:00Z" }]),
      ),
    );
    const { container } = renderApp("/workflows");
    expect(await screen.findByText("Purchase over $1,000")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New workflow/ })).toHaveAttribute("href", "/workflows/new");
    await noAxeViolations(container);
  });

  it("builds a route: validates, adds and reorders steps, and creates the draft", async () => {
    db.sessionUser = ADAM;
    useMembers();
    const created: unknown[] = [];
    server.use(
      http.post("/api/v1/org/workflow-templates", async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json({ ...TEMPLATE, id: "t-new" }, { status: 201 });
      }),
      http.get("/api/v1/org/workflow-templates/:id", () => HttpResponse.json({ ...TEMPLATE, id: "t-new" })),
    );
    const { router, container } = renderApp("/workflows/new");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Create draft" }));
    expect(screen.getByText("Name the workflow (at least 2 characters).")).toBeInTheDocument();
    expect(screen.getByText("Name this step (at least 2 characters).")).toBeInTheDocument();
    expect(created).toEqual([]);

    await user.type(screen.getByLabelText("Workflow name"), "Laptop purchase");
    await user.type(screen.getByLabelText("Step 1 name"), "Finance review");
    await user.click(screen.getByRole("button", { name: "Add step" }));
    await user.type(screen.getByLabelText("Step 2 name"), "Manager approval");
    await user.click(screen.getAllByRole("radio", { name: "A specific person" })[1]!);
    await user.selectOptions(screen.getByLabelText("Person who approves step 2"), "u-m-maya");
    await user.click(screen.getByRole("button", { name: "Move step 2 up" }));

    const preview = screen.getByRole("figure", { name: "Preview of the approval route" });
    const names = within(preview).getAllByRole("listitem").map((li) => li.textContent);
    expect(names[0]).toContain("Manager approval");
    expect(names[0]).toContain("Maya Member");
    expect(names[1]).toContain("Finance review");
    await noAxeViolations(container);

    await user.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/workflows/t-new"));
    expect(created).toEqual([
      {
        name: "Laptop purchase",
        category: "purchase",
        description: "",
        steps: [
          { name: "Manager approval", approver_type: "user", approver_user: "u-m-maya", approver_role: "" },
          { name: "Finance review", approver_type: "role", approver_user: null, approver_role: "admin" },
        ],
      },
    ]);
  });

  it("publishes the draft after confirmation", async () => {
    db.sessionUser = ADAM;
    useMembers();
    let published = false;
    server.use(
      http.get("/api/v1/org/workflow-templates/:id", () => HttpResponse.json(TEMPLATE)),
      http.post("/api/v1/org/workflow-templates/:id/publish", () => {
        published = true;
        return HttpResponse.json({ ...TEMPLATE.draft, status: "published" });
      }),
    );
    renderApp("/workflows/t1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Publish version 1" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Publish version 1?" });
    await user.click(within(dialog).getByRole("button", { name: "Publish version 1" }));
    expect(await screen.findByText("Version 1 published")).toBeInTheDocument();
    expect(published).toBe(true);
  });

  it("shows server step errors next to the right step", async () => {
    db.sessionUser = ADAM;
    useMembers();
    server.use(
      http.get("/api/v1/org/workflow-templates/:id", () => HttpResponse.json(TEMPLATE)),
      http.put("/api/v1/org/workflow-templates/:id/draft", () =>
        problem(400, "One or more fields are invalid.", { errors: { steps: { "0": { approver_user: ["The approver must be a member of this organization."] } } } }),
      ),
    );
    renderApp("/workflows/t1");
    const user = userEvent.setup();
    await user.click(await screen.findAllByRole("radio", { name: "A specific person" }).then((r) => r[0]!));
    await user.selectOptions(screen.getByLabelText("Person who approves step 1"), "u-m-maya");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("The approver must be a member of this organization.")).toBeInTheDocument();
  });

  it("shows members a read-only route", async () => {
    db.sessionUser = ADAM;
    db.memberships = { "orbital-supplies": "member" };
    useMembers();
    server.use(
      http.get("/api/v1/org/workflow-templates/:id", () =>
        HttpResponse.json({ ...TEMPLATE, draft: null, published: { ...TEMPLATE.draft!, status: "published", published_at: "2026-11-02T10:00:00Z", published_by: "Adam Admin" } }),
      ),
    );
    renderApp("/workflows/t1");
    expect(await screen.findByText(/Version 1, published/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save draft|Publish/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
