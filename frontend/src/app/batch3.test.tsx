import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { AuditEvent, InboxItem, RequestDetail, TemplateSummary, User } from "../api/client";
import { renderApp } from "../test/render";
import { ADAM, db, server } from "../test/server";

const problem = (status: number, message: string, extra: object = {}) =>
  HttpResponse.json({ type: "urn:flowops:problem:x", title: "Error", status, detail: message, instance: "/", ...extra }, { status });

const person = (id: string, name: string): User => ({
  id,
  email: `${name.toLowerCase().replace(" ", ".")}@flowops.test`,
  full_name: name,
  date_joined: "2026-11-01T10:00:00Z",
});
const MAYA = person("u-maya", "Maya Member");
const RAJ = person("u-raj", "Raj Approver");

const REQUEST_ID = "0b3e8c52-6a3e-4f43-9d55-5c4b3a6c1a01";

function detail(overrides: Partial<RequestDetail> = {}): RequestDetail {
  return {
    id: REQUEST_ID,
    title: "Monitor arms for the support team",
    status: "in_review",
    template: { id: "t1", name: "Purchase over $1,000" },
    amount: "1890.00",
    currency: "USD",
    requester: MAYA,
    current_step: 2,
    step_count: 3,
    submitted_at: "2026-11-20T09:00:00Z",
    closed_at: null,
    created_at: "2026-11-20T08:50:00Z",
    updated_at: "2026-11-20T09:30:00Z",
    description: "Six arms for the new desks.",
    version: 1,
    revision: 2,
    tasks: [
      {
        id: "k1",
        step_order: 1,
        step_name: "Team lead approval",
        approver_type: "user",
        approver_user: RAJ,
        approver_role: "",
        status: "approved",
        decided_by: RAJ,
        decided_at: "2026-11-20T09:30:00Z",
        comment: "Needed for the new desks.",
        fallback: false,
      },
      {
        id: "k2",
        step_order: 2,
        step_name: "Finance review",
        approver_type: "role",
        approver_user: null,
        approver_role: "admin",
        status: "open",
        decided_by: null,
        decided_at: null,
        comment: "",
        fallback: false,
      },
    ],
    upcoming_steps: [{ order: 3, name: "Owner sign-off", approver_type: "role", approver_user: null, approver_role: "owner" }],
    needs_admin: false,
    permissions: { can_edit: false, can_submit: false, can_cancel: false, cancel_requires_reason: false, can_duplicate: false, decision: "regular" },
    duplicated_from: null,
    ...overrides,
  } as RequestDetail;
}

function useRequestDetail(data: RequestDetail) {
  server.use(
    http.get("/api/v1/org/requests/:id", () => HttpResponse.json(data)),
    http.get("/api/v1/org/requests/:id/comments", () => HttpResponse.json([])),
    http.get("/api/v1/org/requests/:id/timeline", () =>
      HttpResponse.json([
        { id: "e1", verb: "request.created", actor_email: MAYA.email, data: {}, created_at: "2026-11-20T08:50:00Z" },
        { id: "e2", verb: "request.submitted", actor_email: MAYA.email, data: { version: 1 }, created_at: "2026-11-20T09:00:00Z" },
        { id: "e3", verb: "task.approved", actor_email: RAJ.email, data: { step: 1, step_name: "Team lead approval" }, created_at: "2026-11-20T09:30:00Z" },
      ]),
    ),
  );
}

async function noAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

describe("request detail", () => {
  it("lets an approver decide the current step and shows the route and audit trail", async () => {
    db.sessionUser = ADAM;
    useRequestDetail(detail());
    const seen: { url: string; body: unknown; org: string | null }[] = [];
    server.use(
      http.post("/api/v1/org/requests/:id/approve", async ({ request }) => {
        seen.push({ url: new URL(request.url).pathname, body: await request.json(), org: request.headers.get("X-Organization") });
        return HttpResponse.json(detail({ current_step: 3 }));
      }),
    );
    const { container } = renderApp(`/requests/${REQUEST_ID}`);
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "Your decision on step 2" })).toBeInTheDocument();
    const route = screen.getByRole("region", { name: "Approval route" });
    expect(within(route).getByText("Team lead approval")).toBeInTheDocument();
    expect(within(route).getByText("Owner sign-off")).toBeInTheDocument();
    const trail = screen.getByRole("complementary", { name: "Audit trail" });
    expect(await within(trail).findByText("Submitted for approval (workflow version 1)")).toBeInTheDocument();
    expect(within(trail).getByText("Approved step 1, Team lead approval")).toBeInTheDocument();
    await noAxeViolations(container);

    await user.click(screen.getByRole("button", { name: "Approve step 2" }));
    expect(await screen.findByText("Step 2 approved")).toBeInTheDocument();
    // The step being decided is always sent, so a stale page can't approve a later step.
    expect(seen).toEqual([{ url: `/api/v1/org/requests/${REQUEST_ID}/approve`, body: { step: 2, comment: "" }, org: "orbital-supplies" }]);
  });

  it("requires a comment to reject and never sends the request without one", async () => {
    db.sessionUser = ADAM;
    useRequestDetail(detail());
    let calls = 0;
    server.use(
      http.post("/api/v1/org/requests/:id/reject", () => {
        calls += 1;
        return HttpResponse.json(detail({ status: "rejected", current_step: null }));
      }),
    );
    renderApp(`/requests/${REQUEST_ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Reject request" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a comment explaining the rejection.");
    expect(calls).toBe(0);

    await user.type(screen.getByRole("textbox", { name: /^Comment/ }), "Budget is frozen.");
    await user.click(screen.getByRole("button", { name: "Reject request" }));
    expect(await screen.findByText("Request rejected")).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it("tells the loser of a simultaneous decision that nothing was saved", async () => {
    db.sessionUser = ADAM;
    let decided = false;
    server.use(
      http.get("/api/v1/org/requests/:id", () =>
        HttpResponse.json(
          decided ? detail({ status: "rejected", current_step: null, permissions: { ...detail().permissions, decision: null } }) : detail(),
        ),
      ),
      http.get("/api/v1/org/requests/:id/comments", () => HttpResponse.json([])),
      http.get("/api/v1/org/requests/:id/timeline", () => HttpResponse.json([])),
      http.post("/api/v1/org/requests/:id/approve", () => {
        decided = true;
        return problem(409, "This step has already been decided.");
      }),
    );
    renderApp(`/requests/${REQUEST_ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Approve step 2" }));
    expect(await screen.findByText("Someone else decided this step first.")).toBeInTheDocument();
    // The page refreshed: the request is rejected and the decision panel is gone.
    await waitFor(() => expect(screen.queryByRole("heading", { name: /Your decision/ })).not.toBeInTheDocument());
    expect(screen.getAllByText("Rejected").length).toBeGreaterThan(0);
  });

  it("shows the requester no decision panel, and submitting sends the revision", async () => {
    db.sessionUser = MAYA;
    db.memberships = { "orbital-supplies": "member" };
    const draft = detail({
      status: "draft",
      current_step: null,
      submitted_at: null,
      tasks: [],
      upcoming_steps: [
        { order: 1, name: "Team lead approval", approver_type: "user", approver_user: RAJ, approver_role: "" },
        { order: 2, name: "Finance review", approver_type: "role", approver_user: null, approver_role: "admin" },
      ],
      permissions: { can_edit: true, can_submit: true, can_cancel: true, cancel_requires_reason: false, can_duplicate: false, decision: null },
    });
    useRequestDetail(draft);
    const bodies: unknown[] = [];
    server.use(
      http.post("/api/v1/org/requests/:id/submit", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(detail({ requester: MAYA, permissions: { ...draft.permissions, can_edit: false, can_submit: false } }));
      }),
    );
    const { container } = renderApp(`/requests/${REQUEST_ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Submit for approval" }));
    expect(screen.queryByRole("heading", { name: /Your decision/ })).not.toBeInTheDocument();
    const dialog = screen.getByRole("alertdialog", { name: "Submit for approval?" });
    await noAxeViolations(container);
    await user.click(within(dialog).getByRole("button", { name: "Submit for approval" }));
    expect(await screen.findByText("Request submitted")).toBeInTheDocument();
    expect(bodies).toEqual([{ revision: 2 }]);
  });

  it("says a request outside your access was not found", async () => {
    db.sessionUser = ADAM;
    server.use(http.get("/api/v1/org/requests/:id", () => problem(404, "Request not found.")));
    renderApp(`/requests/${REQUEST_ID}`);
    expect(await screen.findByRole("heading", { name: "Request not found" })).toBeInTheDocument();
  });
});

describe("new request", () => {
  it("validates the amount and creates a draft with the chosen workflow", async () => {
    db.sessionUser = MAYA;
    db.memberships = { "orbital-supplies": "member" };
    const published = { id: "t1", name: "Purchase over $1,000", published_version: 1 } as unknown as TemplateSummary;
    const bodies: unknown[] = [];
    useRequestDetail(detail({ status: "draft", requester: MAYA }));
    server.use(
      http.get("/api/v1/org/workflow-templates", () => HttpResponse.json([published])),
      http.post("/api/v1/org/requests", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(detail({ status: "draft", requester: MAYA }), { status: 201 });
      }),
    );
    const { container } = renderApp("/requests/new");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Workflow"), "t1");
    await user.type(screen.getByLabelText("Title"), "Monitor arms");
    await user.type(screen.getByLabelText("Amount", { selector: "input" }), "12.345");
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    expect(await screen.findByText("Use a positive number with up to 2 decimals.")).toBeInTheDocument();
    expect(bodies).toEqual([]);
    await noAxeViolations(container);

    await user.clear(screen.getByLabelText("Amount", { selector: "input" }));
    await user.type(screen.getByLabelText("Amount", { selector: "input" }), "1890.50");
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    expect(await screen.findByText("Draft created")).toBeInTheDocument();
    expect(bodies).toEqual([{ template: "t1", title: "Monitor arms", description: "", amount: "1890.50", currency: "USD" }]);
  });
});

describe("inbox and notifications", () => {
  it("lists steps waiting for me, flags admin fallbacks, and counts them in the navigation", async () => {
    db.sessionUser = ADAM;
    const item = (id: string, title: string, needsAdmin: boolean): InboxItem =>
      ({
        id,
        step_order: 2,
        step_name: "Finance review",
        approver_type: "role",
        approver_role: "admin",
        created_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        needs_admin: needsAdmin,
        request: { ...detail(), id: `r-${id}`, title },
      }) as unknown as InboxItem;
    server.use(
      http.get("/api/v1/org/inbox", () =>
        HttpResponse.json({ count: 2, limit: 200, results: [item("a", "Monitor arms", false), item("b", "Standing desks", true)] }),
      ),
    );
    const { container } = renderApp("/inbox");
    const desks = await screen.findByRole("link", { name: /Standing desks/ });
    expect(within(desks).getByText("Needs an administrator")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Monitor arms/ })).toHaveAttribute("href", "/requests/r-a");
    expect(within(screen.getAllByRole("navigation", { name: "Main" })[0]!).getByRole("link", { name: /^Inbox/ })).toHaveTextContent("Inbox2 waiting");
    expect(desks).toHaveTextContent("Waiting 3 hours");
    await noAxeViolations(container);
  });

  it("shows unread notifications and marks one read when opened", async () => {
    db.sessionUser = MAYA;
    db.memberships = { "orbital-supplies": "member" };
    let unread = true;
    const read: string[] = [];
    useRequestDetail(detail({ requester: MAYA, permissions: { ...detail().permissions, decision: null } }));
    server.use(
      http.get("/api/v1/org/notifications/unread", () => HttpResponse.json({ unread: unread ? 1 : 0 })),
      http.get("/api/v1/org/notifications", () =>
        HttpResponse.json({
          next: null,
          previous: null,
          results: [
            {
              id: "n1",
              kind: "request_approved",
              request: REQUEST_ID,
              request_title: "Monitor arms for the support team",
              read_at: unread ? null : "2026-11-21T10:00:00Z",
              created_at: new Date().toISOString(),
            },
          ],
        }),
      ),
      http.post("/api/v1/org/notifications/:id/read", ({ params }) => {
        read.push(String(params.id));
        unread = false;
        return HttpResponse.json({});
      }),
    );
    const { router } = renderApp("/overview");
    const user = userEvent.setup();
    const bell = (await screen.findAllByRole("button", { name: "Notifications, 1 unread" }))[0]!;
    await user.click(bell);
    const item = await screen.findByRole("menuitem", { name: /Your request was approved/ });
    expect(item).toHaveTextContent("Monitor arms for the support team");
    await user.click(item);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/requests/${REQUEST_ID}`));
    expect(read).toEqual(["n1"]);
    expect((await screen.findAllByRole("button", { name: "Notifications" })).length).toBeGreaterThan(0);
  });
});

describe("audit log", () => {
  const event = (id: string, verb: string, data: object = {}): AuditEvent =>
    ({
      id,
      verb,
      actor_id: "u1",
      actor_email: ADAM.email,
      target_type: "request",
      target_id: REQUEST_ID,
      data,
      request_id: "req-1",
      created_at: "2026-11-21T10:00:00Z",
    }) as AuditEvent;

  it("is hidden from members, in the page and the navigation", async () => {
    db.sessionUser = MAYA;
    db.memberships = { "orbital-supplies": "member" };
    renderApp("/audit");
    expect(await screen.findByRole("heading", { name: "Only admins can see the audit log" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Audit log" })).not.toBeInTheDocument();
  });

  it("lets admins filter by area and load older entries", async () => {
    db.sessionUser = ADAM;
    const queries: string[] = [];
    server.use(
      http.get("/api/v1/org/audit-events", ({ request }) => {
        const url = new URL(request.url);
        queries.push(url.search);
        if (url.searchParams.get("cursor") === "older") {
          return HttpResponse.json({ next: null, previous: null, results: [event("e3", "request.created")] });
        }
        return HttpResponse.json({
          next: "http://testserver/api/v1/org/audit-events?cursor=older",
          previous: null,
          results: [event("e1", "task.approved", { step: 2, fallback: true }), event("e2", "member.role_changed", { role: "admin" })],
        });
      }),
    );
    const { container } = renderApp("/audit");
    const user = userEvent.setup();
    expect(await screen.findByRole("link", { name: "Approved a step" })).toHaveAttribute("href", `/requests/${REQUEST_ID}`);
    expect(screen.getByText("task.approved")).toBeInTheDocument(); // technical verb kept as secondary text
    expect(screen.getByRole("cell", { name: "step: 2; fallback: true" })).toBeInTheDocument();
    await noAxeViolations(container);

    await user.click(screen.getByRole("button", { name: "Load older entries" }));
    expect(await screen.findByRole("link", { name: "Created the draft" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Area"), "task.");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(queries.some((q) => q.includes("verb=task."))).toBe(true));
  });
});

describe("request list", () => {
  it("shows 25 at a time and loads the next page with the cursor", async () => {
    db.sessionUser = MAYA;
    db.memberships = { "orbital-supplies": "member" };
    const row = (n: number) => ({ ...detail(), id: `r${n}`, title: `Request ${n}` });
    const queries: string[] = [];
    server.use(
      http.get("/api/v1/org/requests", ({ request }) => {
        const url = new URL(request.url);
        queries.push(url.search);
        return url.searchParams.get("cursor") === "p2"
          ? HttpResponse.json({ next: null, previous: null, results: [row(26)] })
          : HttpResponse.json({ next: "http://testserver/api/v1/org/requests?cursor=p2", previous: null, results: [row(1), row(2)] });
      }),
    );
    const { container } = renderApp("/requests");
    const user = userEvent.setup();
    expect(await screen.findByRole("link", { name: /Request 2/ })).toBeInTheDocument();
    await noAxeViolations(container);
    await user.click(screen.getByRole("button", { name: "Show more requests" }));
    expect(await screen.findByRole("link", { name: /Request 26/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more requests" })).not.toBeInTheDocument();
    expect(queries[0]).toContain("scope=mine");
    expect(queries[1]).toContain("cursor=p2");
  });
});
