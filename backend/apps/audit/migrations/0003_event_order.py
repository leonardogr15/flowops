"""AUD-01: logical order of request events (ADR-0007).

- Adds request_seq (nullable). Existing events keep NULL: they are not rewritten (the table is
  append-only) and no order is invented for them; the timeline lists them first, by time.
- New request events must carry a number: CHECK ... NOT VALID applies to new rows only, so the
  historical rows are neither validated nor touched.

Deployment note: the CHECK and the unique index below are created in one step, which scans and
briefly locks audit_auditevent. That is fine at this project's scale; on a very large table, add the
CHECK as NOT VALID then VALIDATE it, and build the index CONCURRENTLY in a separate migration.

Reverse: drops the column and constraints. The numbers assigned to events since this migration
are lost; those events fall back to the previous order (created_at, id). No event is deleted.
"""

from django.db import migrations, models

NEW_REQUEST_EVENTS_ARE_NUMBERED = """
ALTER TABLE audit_auditevent
    ADD CONSTRAINT audit_request_event_numbered
    CHECK (target_type <> 'request' OR request_seq IS NOT NULL) NOT VALID;
"""
DROP_NUMBERED = "ALTER TABLE audit_auditevent DROP CONSTRAINT IF EXISTS audit_request_event_numbered;"


class Migration(migrations.Migration):
    dependencies = [
        ("audit", "0002_append_only_trigger"),
        ("organizations", "0002_invitation"),
    ]

    operations = [
        migrations.AddField(
            model_name="auditevent",
            name="request_seq",
            field=models.PositiveIntegerField(blank=True, editable=False, null=True),
        ),
        migrations.AddConstraint(
            model_name="auditevent",
            constraint=models.UniqueConstraint(
                condition=models.Q(("request_seq__isnull", False)),
                fields=("target_id", "request_seq"),
                name="audit_request_seq_unique",
            ),
        ),
        migrations.AddConstraint(
            model_name="auditevent",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("request_seq__isnull", True), ("target_type", "request"), _connector="OR"
                ),
                name="audit_request_seq_only_for_requests",
            ),
        ),
        migrations.RunSQL(NEW_REQUEST_EVENTS_ARE_NUMBERED, DROP_NUMBERED),
    ]
