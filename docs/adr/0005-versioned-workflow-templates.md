# 0005. Versioned workflow templates instead of a generic workflow engine

- Status: Accepted
- Date: 2026-11-24

## Context

Each organization defines approval routes for kinds of requests (purchases, expenses, access). Routes
change over time, but a request that has already started must keep the route it started with.

## Decision

- A **template** has numbered **versions**; a version is an ordered list of **steps**. A step is
  approved either by a specific member or by anyone with a role.
- At most one **draft** and one **published** version exist per template (partial unique indexes).
  Admins edit only the draft; publishing archives the previous published version.
- **Published versions are immutable**, enforced in the services (they only touch drafts) and in the
  model (`Step.save/delete` raise for non-draft versions). Requests will pin a version id.
- Between 1 and 10 steps; a specific approver must be a member of the same organization.
- Members see only published versions; drafts are visible to admins and owners.

## Alternatives considered

- **Generic BPMN/workflow engine:** far more expressive (branches, parallel paths), but heavy to run,
  hard to reason about, and unnecessary for ordered approvals. Conditional and parallel steps can be
  added later as new step types.
- **Editing templates in place:** simpler, but in-flight requests would silently change route.

## Consequences

- History is preserved (version list with publication dates) at the cost of copying steps per version.
- Future request processing reads steps from the pinned version only.
