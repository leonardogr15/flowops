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

### Order of events (added 2026-11-24, AUD-01)

Wall-clock time is not a reliable order: a clock that steps back (NTP step, virtual machines) can
put a later event before an earlier one, and a database sequence numbers rows when they are
inserted, not when their transaction commits.

- **Events of one request** carry `request_seq`, their position within the request (1, 2, 3...).
  The number comes from `Request.event_seq`, advanced with an atomic `UPDATE` inside the
  transaction that writes the event. Every service that changes a request already holds that
  request's row lock, so writers of the same request are numbered in commit order; several events
  of one transaction are numbered in the order they are written; a rollback undoes the increment,
  so there are no gaps. `Request.save()` never writes `event_seq`, so an instance loaded earlier
  cannot rewind it.
- `services.record_request_event` is the only writer of request events, and `audit.record()`
  refuses a request event without a number. The database enforces it as well: positions are unique
  per request, only request events may have one, and new request events must have one (a `CHECK`
  added `NOT VALID`, so historical rows are not validated or rewritten).
- **The timeline** is ordered by `request_seq`. Events written before this change have no number;
  they are kept as they are and listed first, by `created_at`, which is their approximate order.
  The exact logical order is guaranteed for new events of a request.
- `audit_request_event_numbered` stays `NOT VALID` for good: historical request events have no
  number and are never rewritten, so the constraint can't be validated. It is enforced on every
  new row, which is all it is for. It lives in the migration only (Django's model state doesn't
  know about it).
- **The organization-wide audit log** keeps its time order (`created_at`, `id`), documented as
  approximate. A counter per organization would serialize every write of the organization.

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
- The AUD-01 migration scans and briefly locks the audit table while adding its constraints; fine
  at this scale, but a large production table would need `NOT VALID` + `VALIDATE` and a concurrent
  index build (see the migration).
- Rolling back the AUD-01 migrations drops the request numbers; events then fall back to the time
  order. No event is deleted.
