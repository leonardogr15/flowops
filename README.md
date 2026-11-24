# FlowOps

**English** · [Español](README.es.md)

Multi-tenant approval workflows for operations teams: purchases, expenses and access requests go to
the right approvers, in order, with a record of every decision.

> **Status: early development.** Accounts, organizations, people management and versioned approval
> workflows work end to end. Submitting and approving requests is the next milestone; see
> [Roadmap](#roadmap).

![Django](https://img.shields.io/badge/Django-6.1-0C4B33) ![React](https://img.shields.io/badge/React-19-149ECA) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791) ![License: MIT](https://img.shields.io/badge/license-MIT-blue)

## What works today

- **Sign in** with email and password. Sessions are server-side, CSRF-protected (login included), and failed attempts are throttled.
- **Organizations and roles.** Create organizations, switch between the ones you belong to, and see your role (owner, admin or member).
- **Tenant isolation.** Every request runs in the context of one organization. Data from other organizations is unreachable: such requests get `404`.
- **Role-based permissions.** Members read; admins and owners manage people, workflows and settings; only owners manage owners.
- **Invitations.** Admins invite people by email. Links work once, expire after 7 days and only for the invited address; new people create their account when they accept.
- **Member management.** Change roles, remove members or leave an organization. An organization always keeps at least one owner, even under concurrent changes.
- **Workflow templates.** Define who approves each kind of request and in what order, with a visual step builder and live route preview. Templates are versioned: admins edit a draft and publish it, published versions never change, and members only see published routes.
- **Web app.** Responsive React UI with loading, empty, error and permission states, keyboard navigation and automated accessibility checks.
- **Operational basics.** Health and readiness endpoints, JSON logs with request IDs, RFC 9457 error responses, and OpenAPI docs at `/api/docs/`.

## Architecture

```mermaid
flowchart LR
    B[Browser<br/>React SPA] -->|same origin| N[nginx<br/>static files + reverse proxy]
    N -->|/api, /health| A[Django + DRF<br/>gunicorn]
    A --> P[(PostgreSQL 18)]
    A --> R[(Redis<br/>cache + throttling)]
```

| Layer | Responsibility |
|---|---|
| `backend/apps/accounts` | Email-based user model, session login/logout, login throttling |
| `backend/apps/organizations` | Organizations, memberships, roles, tenant resolution, permissions, invitations |
| `backend/apps/workflows` | Workflow templates, versions and approval steps |
| `backend/common` | Problem-details errors, request-ID middleware, JSON logging, health checks |
| `frontend/src` | React app: API client generated from the OpenAPI schema, session and organization context, pages |

Inside each Django app, **views** handle HTTP only, **services** perform writes inside transactions,
and **selectors** perform tenant-scoped reads.

### Technical decisions

- [ADR-0001 Multi-tenancy: shared schema, application-enforced isolation](docs/adr/0001-multi-tenancy.md)
- [ADR-0002 Authentication: server sessions with CSRF for a same-origin SPA](docs/adr/0002-authentication.md)
- [ADR-0003 Runtime and tooling versions](docs/adr/0003-runtime-and-tooling-versions.md)
- [ADR-0004 Invitations and owner protection](docs/adr/0004-invitations-and-owner-protection.md)
- [ADR-0005 Versioned workflow templates instead of a generic workflow engine](docs/adr/0005-versioned-workflow-templates.md)

## Quick start

Requirements: Docker with Compose v2, and `make`. Running the frontend tests or the end-to-end tests
outside Docker also needs Node.js 22+.

```bash
git clone https://github.com/leonardogr15/flowops.git
cd flowops
make demo   # creates .env with random local secrets, builds, starts, seeds demo data
```

Without `make` (for example on Windows), run the same steps directly:

```bash
python scripts/make_env.py
docker compose up -d --build --wait
docker compose exec api python manage.py seed_demo
```

Open <http://localhost:8080>. API docs: <http://localhost:8080/api/docs/>.

> The Compose stack is a **local demo**: the API runs Django's development server with `DEBUG`
> on, ports are bound to `127.0.0.1`, and cookies are not marked `Secure` because it serves plain
> HTTP. It is not a deployment configuration. The production image (`backend/Dockerfile`, target
> `runtime`) uses gunicorn with `config.settings.prod` and is built in CI. The Django admin is not
> exposed through nginx; locally it is at <http://localhost:8000/admin/>.

### Demo accounts

All demo users share the password stored as `DEMO_PASSWORD` in your generated `.env`. People and
companies are fictional.

| Email | Organization | Role |
|---|---|---|
| `olivia.owner@flowops.test` | Orbital Supplies Co. | Owner |
| `adam.admin@flowops.test` | Orbital Supplies Co. | Admin |
| `maya.member@flowops.test` | Orbital Supplies Co. | Member |
| `raj.approver@flowops.test` | Orbital Supplies Co. / Kestrel Analytics | Member / Admin |
| `kim.owner@flowops.test` | Kestrel Analytics | Owner |

Signing in as Maya and Adam shows the permission differences on the Members, Workflows and Settings
pages. Raj can switch between two organizations. The demo includes a published workflow and a draft.
Invitation emails are printed to the API log (`docker compose logs api`); the invite dialog also shows
the link once.

## API overview

All endpoints are under `/api/v1/`. Unsafe methods need the `X-CSRFToken` header. Tenant-scoped
endpoints need `X-Organization: <organization slug>`.

| Method and path | Auth | Tenant-scoped | Member | Admin | Owner |
|---|---|---|:-:|:-:|:-:|
| `GET /auth/csrf` | none | no | – | – | – |
| `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` | session | no | – | – | – |
| `GET /organizations` (mine) · `POST /organizations` (create, become owner) | session | no | – | – | – |
| `GET /org` | session | yes | yes | yes | yes |
| `PATCH /org` (rename) | session | yes | no (403) | yes | yes |
| `GET /org/members` | session | yes | yes | yes | yes |
| `PATCH /org/members/{id}` (role) · `DELETE /org/members/{id}` | session | yes | leave only | yes¹ | yes |
| `GET /org/invitations` · `POST /org/invitations` · `DELETE /org/invitations/{id}` | session | yes | no (403) | yes | yes |
| `GET /invitations/{token}` · `POST /invitations/{token}/accept` | the token | no | – | – | – |
| `GET /org/workflow-templates` · `GET /org/workflow-templates/{id}` | session | yes | published only | yes | yes |
| `POST /org/workflow-templates` · `PATCH …/{id}` · `PUT …/{id}/draft` · `POST …/{id}/publish` | session | yes | no (403) | yes | yes |

¹ Admins cannot grant, change or remove the owner role; only owners can. The last owner can never be
demoted or removed (`409`).

Status codes: `401` if not signed in, `403` if your role is not allowed, `404` for organizations you
don't belong to (indistinguishable from ones that don't exist), and `400` if the organization header
is missing. Errors use `application/problem+json`.

## Security

| Control | Where |
|---|---|
| Session cookie `HttpOnly`, `SameSite=Lax`, `Secure` outside local dev | `config/settings/base.py` |
| CSRF on every unsafe request, including login | `apps/accounts/api/views.py` |
| Argon2 password hashing, minimum length 12 | `config/settings/base.py` |
| Generic error for unknown email, wrong password and inactive user | `LoginView` |
| Login throttling per (client IP, email) and per client IP across all emails, with a trusted proxy count so `X-Forwarded-For` can't be spoofed; emails are hashed in throttle keys | `apps/accounts/throttles.py`, `NUM_PROXIES` |
| Cross-tenant requests return 404; isolation harness covers every endpoint, including object ids from another organization | `apps/organizations/tests/test_isolation.py` |
| Invitation tokens: 256-bit random, stored only as SHA-256, single use, 7-day expiry, bound to the invited email; re-inviting revokes the previous link | `apps/organizations/members.py` |
| Role changes re-read the acting member and lock owner rows, so concurrent demotions cannot remove the last owner | `apps/organizations/members.py` |
| Published workflow versions are immutable (enforced in services and in the model) | `apps/workflows/` |
| Deny-by-default permissions; role checks on the server, never only in the UI | `apps/organizations/permissions.py` |
| UUIDv7 public IDs (no sequential IDs in URLs) | `common/models.py` |
| CSP (including `object-src 'none'`), `X-Frame-Options`, `nosniff`, `Referrer-Policy` on every response; Django admin not routed through the public entrypoint | `frontend/security-headers.conf`, `frontend/nginx.conf` |
| Containers run as non-root; secrets only via environment | `Dockerfile`s, `.env.example` |
| Secret scanning of the full git history and the working tree in CI | `.github/workflows/ci.yml` (gitleaks) |

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Testing

| Suite | Command | What it covers |
|---|---|---|
| Backend | `make test-api` | Auth, CSRF, throttling, tenancy, permission matrices, cross-tenant isolation, invitations, last-owner protection under concurrency, workflow versioning. Coverage gate: 85% |
| Backend lint/types | `make lint-api` | ruff, mypy (strict, with Django and DRF plugins) |
| Frontend | `make test-web` | Sign-in, redirects, organization switching, settings, members and roles, invitations and acceptance, workflow builder and publishing, axe accessibility checks |
| Frontend lint/types | `make lint-web` | oxlint (warnings fail), TypeScript strict |
| End-to-end | `make e2e` (stack running, `DEMO_PASSWORD` exported) | Playwright on desktop and mobile viewports against the real stack: sign-in, invite and join, build and publish a workflow |
| Contract | `make schema-check` | Committed OpenAPI schema matches the code; generated TypeScript types match the schema (CI) |

The CI workflow (`.github/workflows/ci.yml`) is configured to run all of the above on every push and pull request, plus a production image build and gitleaks over the full history.

## Project layout

```
backend/        Django project (config/, apps/, common/), openapi.yaml, Dockerfile
frontend/       React app (src/), Playwright tests (e2e/), nginx config, Dockerfile
docs/adr/       Architecture decision records
scripts/        Local helper scripts
```

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| Foundation | Accounts, organizations, tenancy, permissions, app shell | **Done** |
| People | Invitations by email, member management, last-owner protection | **Done** |
| Workflows | Versioned workflow templates with ordered approval steps | **Done** |
| Requests | Submit, approve, reject, comment; state machine with concurrency safety; audit trail | Next |
| Notifications | In-app and email notifications | Planned |
| Hardening | PostgreSQL Row-Level Security, OIDC sign-in, rate limits per tenant | Later |

## License

[MIT](LICENSE) © 2026 Leonardo Galvis
