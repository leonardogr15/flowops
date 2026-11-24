/** Regression tests for the audit's batch A fixes (FE-01..FE-05, BE-01, BE-02 in the UI). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { Member, RequestDetail } from "../api/client";
import { cursorOf } from "../api/pagination";
import { renderApp } from "../test/render";
import { ADAM, db, server } from "../test/server";

const problem = (status: number, message: string, extra: object = {}) =>
  HttpResponse.json({ type: "urn:flowops:problem:x", title: "Error", status, detail: message, instance: "/", ...extra }, { status });

const member = (n: number): Member => ({
  id: `m-${n}`,
  role: "member",
  user: { id: `u-${n}`, email: `person${n}@flowops.test`, full_name: `Person ${n}`, date_joined: "2026-11-01T10:00:00Z" },
  created_at: "2026-11-01T10:00:00Z",
});

const REQUEST_ID = "0b3e8c52-6a3e-4f43-9d55-5c4b3a6c1a01";

function request(overrides: Partial<RequestDetail> = {}): RequestDetail {
  return {
    id: REQUEST_ID,
    title: "Monitor arms",
    status: "in_review",
    template: { id: "t1", name: "Purchase over $1,000" },
    amount: "1890.00",
    currency: "USD",
    requester: { id: "u-maya", email: "maya.member@flowops.test", full_name: "Maya Member", date_joined: "2026-11-01T10:00:00Z" },
    current_step: 1,
    step_count: 1,
    submitted_at: "2026-11-20T09:00:00Z",
    closed_at: null,
    created_at: "2026-11-20T08:50:00Z",
    updated_at: "2026-11-20T09:30:00Z",
    description: "",
    version: 1,
    revision: 2,
    tasks: [],
    upcoming_steps: [],
    needs_admin: false,
    permissions: { can_edit: false, can_submit: false, can_cancel: false, cancel_requires_reason: false, can_duplicate: false, decision: null },
    duplicated_from: null,
    ...overrides,
  } as RequestDetail;
}

function useRequestDetail(data: RequestDetail) {
  server.use(
    http.get("/api/v1/org/requests/:id", () => HttpResponse.json(data)),
    http.get("/api/v1/org/requests/:id/comments", () => HttpResponse.json([])),
    http.get("/api/v1/org/requests/:id/timeline", () => HttpResponse.json([])),
  );
}

describe("FE-01 expired session", () => {
  it("returns to the login page with an explanation and back to the same page after signing in", async () => {
    db.sessionUser = ADAM;
    let expired = true;
    server.use(
      http.get("/api/v1/org/members", () =>
        expired
          ? problem(401, "Authentication credentials were not provided.")
          : HttpResponse.json({ next: null, previous: null, results: [member(1)] }),
      ),
      http.get("/api/v1/org/invitations", () => HttpResponse.json([])),
    );
    const { router } = renderApp("/members");
    const user = userEvent.setup();

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(await screen.findByText(/Your session ended/)).toBeInTheDocument();

    // A wrong password during sign-in is a normal 401: it must not be treated as another expiry.
    await user.type(screen.getByLabelText("Work email"), ADAM.email);
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password don't match an account.");

    expired = false;
    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "right-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/members"));
    expect(await screen.findByText("Person 1")).toBeInTheDocument();
  });

  it("also ends the session when a mutation gets 401", async () => {
    db.sessionUser = ADAM;
    useRequestDetail(
      request({ requester: { ...ADAM }, permissions: { ...request().permissions, can_cancel: true } }),
    );
    server.use(http.post("/api/v1/org/requests/:id/cancel", () => problem(401, "Authentication credentials were not provided.")));
    const { router } = renderApp(`/requests/${REQUEST_ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel request" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });
});

describe("FE-02 members beyond the first page", () => {
  const page1 = Array.from({ length: 50 }, (_, i) => member(i + 1));
  const page2 = [member(51), member(52)];

  function useTwoPages() {
    server.use(
      http.get("/api/v1/org/members", ({ request: req }) => {
        const cursor = new URL(req.url).searchParams.get("cursor");
        return cursor === "p2"
          ? HttpResponse.json({ next: null, previous: null, results: page2 })
          : HttpResponse.json({ next: "/api/v1/org/members?cursor=p2", previous: null, results: page1 });
      }),
      http.get("/api/v1/org/invitations", () => HttpResponse.json([])),
    );
  }

  it("shows more members on request", async () => {
    db.sessionUser = ADAM;
    useTwoPages();
    renderApp("/members");
    const user = userEvent.setup();
    expect(await screen.findByText("Person 50")).toBeInTheDocument();
    expect(screen.queryByText("Person 52")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show more members" }));
    expect(await screen.findByText("Person 52")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more members" })).not.toBeInTheDocument();
  });

  it("lets admins pick an approver from any page", async () => {
    db.sessionUser = ADAM;
    useTwoPages();
    renderApp("/workflows/new");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "A specific person" }));
    const picker = screen.getByLabelText("Person who approves step 1");
    expect(within(picker).getByRole("option", { name: /Person 52/ })).toBeInTheDocument();
  });
});

describe("FE-03 overview", () => {
  it("describes what the product does today and links to it", async () => {
    db.sessionUser = ADAM;
    server.use(http.get("/api/v1/org/inbox", () => HttpResponse.json({ count: 3, limit: 200, results: [] })));
    renderApp("/overview");
    expect(await screen.findByText("3 steps are waiting for your decision.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open your inbox" })).toHaveAttribute("href", "/inbox");
    expect(screen.getByRole("link", { name: "Create a request" })).toHaveAttribute("href", "/requests/new");
    expect(screen.getByRole("link", { name: "Open the audit log" })).toHaveAttribute("href", "/audit");
    expect(screen.queryByText(/next release/)).not.toBeInTheDocument();
  });
});

describe("FE-04 and FE-05", () => {
  it("tells the person when duplicating fails", async () => {
    db.sessionUser = ADAM;
    useRequestDetail(
      request({ status: "rejected", requester: { ...ADAM }, permissions: { ...request().permissions, can_duplicate: true } }),
    );
    server.use(http.post("/api/v1/org/requests/:id/duplicate", () => problem(409, "The workflow has no published version.")));
    const { router } = renderApp(`/requests/${REQUEST_ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Duplicate as new draft" }));
    expect(await screen.findByText("The workflow has no published version.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/requests/${REQUEST_ID}`);
  });

  it("reads cursors from absolute and relative links", () => {
    expect(cursorOf("http://testserver/api/v1/org/audit-events?cursor=abc")).toBe("abc");
    expect(cursorOf("/api/v1/org/members?cursor=p2&page_size=50")).toBe("p2");
    expect(cursorOf(null)).toBeUndefined();
    expect(cursorOf("/api/v1/org/members")).toBeUndefined();
  });
});

describe("BE-01 and BE-02 in the UI", () => {
  it("asks for a reason before an admin cancels a former member's request", async () => {
    db.sessionUser = ADAM;
    useRequestDetail(request({ permissions: { ...request().permissions, can_cancel: true, cancel_requires_reason: true } }));
    const bodies: unknown[] = [];
    server.use(
      http.post("/api/v1/org/requests/:id/cancel", async ({ request: req }) => {
        bodies.push(await req.json());
        return HttpResponse.json(request({ status: "cancelled" }));
      }),
    );
    renderApp(`/requests/${REQUEST_ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel request" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("no longer a member");
    await user.click(within(dialog).getByRole("button", { name: "Cancel request" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Explain why you are cancelling this request.");
    expect(bodies).toEqual([]);

    await user.type(within(dialog).getByLabelText("Reason (required)"), "Maya left the company.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel request" }));
    expect(await screen.findByText("Request cancelled")).toBeInTheDocument();
    expect(bodies).toEqual([{ reason: "Maya left the company." }]);
  });

  it("says when the inbox lists only part of what is waiting", async () => {
    db.sessionUser = ADAM;
    server.use(
      http.get("/api/v1/org/inbox", () =>
        HttpResponse.json({
          count: 250,
          limit: 200,
          results: [
            {
              id: "k1",
              step_order: 1,
              step_name: "Finance review",
              approver_type: "role",
              approver_role: "admin",
              created_at: new Date().toISOString(),
              needs_admin: false,
              request: request(),
            },
          ],
        }),
      ),
    );
    renderApp("/inbox");
    expect(await screen.findByText(/Showing the 1 oldest of 250 steps waiting for you/)).toBeInTheDocument();
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0]!;
    expect(within(nav).getByRole("link", { name: /^Inbox/ })).toHaveTextContent("Inbox250 waiting");
  });
});
