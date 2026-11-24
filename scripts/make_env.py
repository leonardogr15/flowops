"""Create .env from .env.example, replacing every change-me value with a random secret."""

import re
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root / ".env"
if target.exists():
    raise SystemExit(".env already exists; not overwriting")
text = (root / ".env.example").read_text(encoding="utf-8")
text = re.sub(r"change-me[\w-]*", lambda _: secrets.token_urlsafe(24), text)
target.write_text(text, encoding="utf-8")
print("Created .env with random local secrets (DEMO_PASSWORD is in .env).")
