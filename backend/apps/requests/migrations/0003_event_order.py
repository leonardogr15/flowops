"""AUD-01: per-request event counter (ADR-0007).

Existing requests start at 0, so their next event is number 1; earlier events keep no number.
Reverse: drops the column; the counter values are lost (they can't be rebuilt exactly).
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("requests", "0002_request_requests_in_review_has_current_step"),
    ]

    operations = [
        migrations.AddField(
            model_name="request",
            name="event_seq",
            field=models.PositiveIntegerField(default=0, editable=False),
        ),
    ]
