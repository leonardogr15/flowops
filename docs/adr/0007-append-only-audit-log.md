# 0007. Append-only audit log

- Status: Accepted
- Date: 2026-11-24

## Context

Approvals are only useful if people can trust the record of who decided what and when. Admins need
the history of requests, decisions, memberships and workflow changes; requesters and approvers need
the history of the requests they can see.

## Decision

- One `AuditEvent` table per deployment, scoped by organization. Each event stores the verb (for
  example `task.approved`), the actor's id and a copy of their email (so the record survives account
  changes), the target, a small JSON payload, the HTTP request id and a timestamp.
- Events are written by the services **in the same transaction** as the change they describe. If the
  audit write fails, the change is rolled back.
- **Append-only at two levels:** the model refuses `save()` on existing rows and `delete()`, and a
  PostgreSQL trigger rejects `UPDATE` and `DELETE` on the table.
- Read access: the request timeline (`/org/requests/{id}/timeline`) for anyone who can see the
  request; the organization log (`/org/audit-events`, filters and cursor pagination) for admins and
  owners only. There is no write endpoint.
- Only events produced by the application are recorded. History from before this feature is not
  reconstructed.

## Alternatives considered

- **Hash-chained or signed entries:** detect tampering by a database administrator. Not needed yet;
  can be added on top of this table.
- **External log store (for example, a SIEM):** better for retention and separation of duties, but an
  extra service to run for a portfolio-scale deployment.
- **Model history libraries:** record field diffs, not business events, and make "who approved step 2"
  harder to answer.

## Consequences

- The log is tamper-resistant against the application and ordinary SQL, **not** cryptographically
  immutable: a superuser can disable the trigger. This is stated as such in the documentation.
- Migrations that change the table must drop and recreate the trigger deliberately.
- Organizations are protected from deletion while audit events reference them.
