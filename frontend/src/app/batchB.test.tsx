/** Regression tests for batch B accessibility and legibility fixes (FE-06, FE-07). */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoticeProvider, useNotice } from "../shared/ui/overlays";
import { titleFor } from "../shared/layout/pageTitle";
import { renderApp } from "../test/render";
import { ADAM, db, server } from "../test/server";

afterEach(() => vi.useRealTimers());

describe("FE-06a request filter", () => {
  it("is a group of toggle buttons with aria-pressed, not an incomplete tab list", async () => {
    db.sessionUser = ADAM;
    server.use(http.get("/api/v1/org/requests", () => HttpResponse.json({ next: null, previous: null, results: [] })));
    renderApp("/requests");
    const user = userEvent.setup();
    const group = await screen.findByRole("group", { name: "Whose requests" });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "All I can see" }));
    expect(within(group).getByRole("button", { name: "All I can see" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("FE-06b notices", () => {
  function Trigger() {
    const notify = useNotice();
    return (
      <>
        <button onClick={() => notify("Saved")}>ok</button>
        <button onClick={() => notify("The request could not be duplicated.", "error")}>fail</button>
      </>
    );
  }

  it("keeps errors as alerts until dismissed, while confirmations fade", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <NoticeProvider>
        <Trigger />
      </NoticeProvider>,
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "ok" }));
    await user.click(screen.getByRole("button", { name: "fail" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The request could not be duplicated.");
    expect(screen.getByText("Saved")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The request could not be duplicated."); // still there

    await user.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("FE-06c page titles", () => {
  it("names every in-app page", () => {
    expect(titleFor("/inbox")).toBe("Inbox");
    expect(titleFor("/requests/new")).toBe("New request");
    expect(titleFor("/requests/0b3e8c52-6a3e-4f43-9d55-5c4b3a6c1a01")).toBe("Request");
    expect(titleFor("/requests/0b3e8c52-6a3e-4f43-9d55-5c4b3a6c1a01/edit")).toBe("Edit draft");
    expect(titleFor("/workflows/new")).toBe("New workflow");
    expect(titleFor("/nowhere")).toBe("Page not found");
  });

  it("sets the document title as the person moves around", async () => {
    db.sessionUser = ADAM;
    const { router } = renderApp("/inbox");
    await waitFor(() => expect(document.title).toBe("Inbox · FlowOps"));
    await act(() => router.navigate("/members"));
    await waitFor(() => expect(document.title).toBe("Members · FlowOps"));
  });

  it("titles the sign-in page", async () => {
    db.sessionUser = null;
    renderApp("/login");
    await waitFor(() => expect(document.title).toBe("Sign in · FlowOps"));
  });
});

describe("FE-06d step builder", () => {
  it("announces where a moved step went", async () => {
    db.sessionUser = ADAM;
    server.use(http.get("/api/v1/org/members", () => HttpResponse.json({ next: null, previous: null, results: [] })));
    renderApp("/workflows/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Step 1 name"), "Finance review");
    await user.click(screen.getByRole("button", { name: "Add step" }));
    await user.type(screen.getByLabelText("Step 2 name"), "Manager approval");
    await user.click(screen.getByRole("button", { name: "Move step 2 up" }));
    expect(screen.getByText("Manager approval moved to position 1 of 2.")).toHaveAttribute("aria-live", "polite");
  });
});
