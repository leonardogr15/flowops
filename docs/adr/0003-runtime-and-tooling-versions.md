# 0003. Runtime and tooling versions

- Status: Accepted
- Date: 2026-11-23

## Context

The project should start on current, supported versions without being the first to hit ecosystem
gaps. Versions were checked on the date above against the official release pages and PyPI/npm.

## Decision

| Area | Choice | Why |
|---|---|---|
| Python | 3.14 (container `python:3.14-slim`) | 3.15.0 was released in October 2026; libraries need time to catch up |
| Django | 6.1.x | Current feature release; upgrade to 6.2 LTS (scheduled April 2027) as a dedicated change |
| DRF | 3.18.x | Declares support for Django 6.1 |
| drf-spectacular / pytest-django | 0.30 / 4.14 | Classifiers list Django ≤ 6.0; the full test suite and schema validation pass on 6.1, so this is accepted and re-checked on upgrades |
| PostgreSQL | 18 | 19 was released days before this decision; images and extensions lag |
| Package management | `uv` with committed `uv.lock` | Reproducible, fast installs in CI and Docker |
| Frontend | React 19, Vite 8, Tailwind CSS 4, TanStack Query 5, React Router 7 | Current stable majors |
| TypeScript | 5.9 | The Vite template ships TypeScript 7, but `openapi-typescript` (API types generated from the schema) requires TypeScript 5 |
| Linting (frontend) | oxlint (Vite template default) with React, a11y and correctness rules, warnings as errors | Fast and sufficient; ESLint adds little for this codebase |

## Alternatives considered

- **Django 5.2 LTS:** longer support today, but the project would need a two-major-version jump later.
- **TypeScript 7 without generated API types:** faster compiler, but hand-written API types drift from
  the server. Generated types win.

## Consequences

- Dependency upgrades run the same gates as feature work (tests, schema drift, type check).
- Revisit when Django 6.2 LTS ships, and when `openapi-typescript` supports TypeScript 7.
