# 0002. Authentication: server sessions with CSRF for a same-origin SPA

- Status: Accepted
- Date: 2026-11-23

## Context

The React app and the API are served from the same origin (nginx proxies `/api` in production and
Vite proxies it in development). Users are people in organizations; there are no third-party API
clients yet.

## Decision

- Django **session authentication** with an `HttpOnly`, `SameSite=Lax` cookie (`Secure` outside local
  development) and an 8-hour lifetime.
- **CSRF protection on every unsafe request, including login.** DRF skips CSRF for anonymous users, so
  the login view is explicitly wrapped with `csrf_protect` to prevent login CSRF. The SPA reads the
  `csrftoken` cookie (from `GET /api/v1/auth/csrf`) and sends `X-CSRFToken`.
- **Argon2** password hashing; minimum length 12 plus Django's common-password checks.
- **One generic error** for unknown email, wrong password and inactive account.
- **Throttling** of login attempts per (client IP, email) pair (default 5 per minute) and per client IP across all emails (default 30 per minute, against password spraying), backed by Redis. Emails are hashed in throttle keys.
- `login()` rotates the session key (session fixation protection). Unauthenticated requests get 401
  (custom `SessionAuthentication401`), forbidden actions get 403, other tenants get 404.

## Alternatives considered

- **JWT in `localStorage`:** stateless, but any XSS can steal the token, and revocation needs extra
  machinery. No benefit for a same-origin browser client.
- **JWT in an HttpOnly cookie:** removes the XSS read risk but still needs CSRF protection and a
  revocation strategy. More moving parts than sessions for the same result.
- **External identity provider (OIDC):** planned as an advanced feature (FO-201); not needed for the MVP.

## Consequences

- Positive: tokens never reach JavaScript; logout and revocation are immediate; standard Django tooling.
- Negative: the API is cookie-based, so future machine clients need a separate scheme (API keys,
  planned with integrations).
- Per-IP throttling depends on the client IP seen by Django; behind additional proxies the real IP
  forwarding must be configured explicitly before relying on it.
