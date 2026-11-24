# 0001. Multi-tenancy: shared schema, application-enforced isolation

- Status: Accepted
- Date: 2026-11-23

## Context

FlowOps serves many organizations from one deployment. A request from one organization must never
read or change another organization's data. The product is small, needs simple operations, and must
run locally with one `docker compose up`.

## Decision

- **Shared database, shared schema.** Tenant-owned tables inherit `TenantModel`, which adds a
  non-null `organization` foreign key.
- **Tenant context per request.** The client sends the active organization slug in the
  `X-Organization` header. The server accepts it only if the authenticated user has a membership in
  that organization. Unknown organizations and organizations the user does not belong to both return
  **404** with the same body, so the API does not reveal which organizations exist.
- **Scoped access in one place.** Tenant-scoped views use `TenantScopedMixin`; querysets come from
  selectors that take the organization as a required argument.
- **Isolation is tested, not assumed.** `apps/organizations/tests/test_isolation.py` discovers every
  `/api/v1/` endpoint from the URL configuration. Each view must declare `tenant_scoped`, and every
  tenant-scoped endpoint and method is called by a member of another organization, expecting 404 and
  no change to the victim's data. A new endpoint without isolation coverage fails CI.
- **Later, additional:** PostgreSQL Row-Level Security as defense in depth (backlog FO-200). It
  complements, and does not replace, the rules above.

## Alternatives considered

- **Schema per tenant** (e.g. `django-tenants`): strong separation, but migrations run once per tenant,
  connection routing becomes more complex, and cross-tenant reporting is harder. Too heavy for this scope.
- **Database per tenant:** strongest isolation and highest operational cost; not justified here.
- **Default manager that refuses unscoped queries:** tempting, but it breaks Django internals
  (admin, related lookups, migrations) that rely on the default manager. The URL-driven isolation
  harness gives a stronger guarantee at the API boundary with less magic.
- **Tenant from subdomain:** good for production UX, but needs wildcard DNS and TLS for local demos.
  A header keeps the API explicit and easy to test; a subdomain can map to the same header later.

## Consequences

- Positive: one schema, one migration path, cheap tenants, simple local setup.
- Negative: isolation depends on code discipline; a bug in a selector could leak data. Mitigated by
  the harness, code review rules, and RLS later.
- The SPA must send `X-Organization` on tenant requests; the API client does this centrally.
