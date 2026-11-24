# 0006. Request state machine and concurrency control

- Status: Accepted
- Date: 2026-11-24

## Context

A request moves through an ordered approval route. Several people can act on it at the same time:
two admins may decide the same step, the requester may cancel while an approver approves, or a
browser may retry a click. Each of these must produce exactly one outcome, and nobody may approve
their own request.

## Decision

- **Explicit state machine.** `draft → in_review → approved | rejected | cancelled`, with an
  allow-list of transitions in `apps/requests/services.py`. Moving to the next step is not a status
  change (there is no `in_review → in_review` transition), so a repeated submit fails instead of
  restarting the route.
- **Version pinned on submit.** Submitting locks the template row (the same lock that publishing
  takes) and stores the published version. Later edits to the workflow never change an in-flight
  request.
- **Pessimistic locking in a fixed order:** template → request → open task, with
  `SELECT … FOR UPDATE` inside one transaction per command. A fixed order avoids deadlocks.
- **Stale-decision guard.** Approve and reject require the `step` the person saw; if the request has
  moved on, the API answers `409` and nothing is written. Submit requires the draft `revision` for the
  same reason. The UI refreshes on `409` and tells the person their decision was not saved.
- **Database constraints as the last line:** one open task per request, unique `(request, step)`,
  decision fields consistent with task status, `in_review` requires a current step.
- **Eligibility at decision time.** A role step accepts that role or higher; a named step accepts that
  member. The requester is never eligible, whatever their role. If nobody eligible remains (the
  approver left or changed role), an admin or owner other than the requester can decide with a
  mandatory comment; the task and audit event are marked `fallback`. Submit is refused with `422` if a
  step has no possible approver at that moment.

## Alternatives considered

- **Optimistic locking only (version column):** fewer locks, but every writer needs retry logic and
  the "two decisions at once" case becomes a client problem.
- **Advisory locks or a queue per request:** more moving parts for a workload with low contention.
- **Generic workflow engine:** see ADR-0005.

## Consequences

- Concurrency tests run against real PostgreSQL with threads; removing the row locks makes them fail
  (duplicate approvals, approve and reject both applied, double submit).
- Writes on the same request are serialized; that is acceptable for human-paced approvals.
- The same person may decide several steps if eligible for each; every decision is a separate task and
  audit event.
