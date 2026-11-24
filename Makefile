# FlowOps developer commands. Requires Docker; frontend targets also need Node 22+.
COMPOSE := docker compose
E2E := $(COMPOSE) -f docker-compose.yml -f docker-compose.e2e.yml
API := $(COMPOSE) run --rm --no-deps -e DJANGO_SETTINGS_MODULE=config.settings.test api
# Windows usually has `python` (or `py`) rather than `python3`.
PYTHON := $(shell command -v python3 2>/dev/null || command -v python 2>/dev/null || echo py)

.PHONY: help env up down logs demo migrations migrate test-api lint-api schema schema-check \
        web-install test-web lint-web e2e-up e2e e2e-down e2e-reset screenshots demo-gif check

help: ## List targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-14s %s\n", $$1, $$2}'

env: ## Create .env with random local secrets (never overwrites)
	@test -f .env || $(PYTHON) scripts/make_env.py

up: env ## Build and start the stack (http://localhost:8080)
	$(COMPOSE) up -d --build --wait

down: ## Stop the stack (keeps the database volume)
	$(COMPOSE) down

logs: ## Follow API logs
	$(COMPOSE) logs -f api

demo: up ## Seed demo organizations and users
	$(COMPOSE) exec api python manage.py seed_demo

migrations: ## Create migrations after model changes
	$(COMPOSE) run --rm api python manage.py makemigrations

migrate: ## Apply migrations
	$(COMPOSE) exec api python manage.py migrate

test-api: ## Backend tests with coverage (needs the db service)
	$(COMPOSE) up -d --wait db redis
	$(API) pytest

lint-api: ## Ruff + mypy
	$(API) sh -c "ruff format --check . && ruff check . && mypy ."

schema: ## Regenerate OpenAPI schema and TypeScript types
	$(API) python manage.py spectacular --file openapi.yaml --validate --fail-on-warn
	cd frontend && npm run api:types

schema-check: ## Fail if the committed OpenAPI schema is out of date
	$(API) sh -c "python manage.py spectacular --file /tmp/openapi.yaml --validate --fail-on-warn && diff -u openapi.yaml /tmp/openapi.yaml"

web-install: ## Install frontend dependencies and Playwright's Chromium (needed by the *-web and e2e targets)
	cd frontend && npm ci && npx playwright install chromium

test-web: ## Frontend unit/component tests
	cd frontend && npm test

lint-web: ## Frontend lint + type check
	cd frontend && npm run lint && npm run typecheck

e2e-up: env ## Start the isolated end-to-end stack (own project and database; stop the demo first)
	$(E2E) up -d --build --wait
	$(E2E) exec -T api python manage.py seed_demo

e2e: ## Playwright against the end-to-end stack (reads DEMO_PASSWORD from .env)
	cd frontend && DEMO_PASSWORD="$${DEMO_PASSWORD:-$$(grep '^DEMO_PASSWORD=' ../.env | cut -d= -f2-)}" npm run e2e

e2e-down: ## Stop the end-to-end stack (keeps its database)
	$(E2E) down

# README media. Run against a freshly seeded end-to-end stack (make e2e-reset e2e-up): the scripts
# add a few synthetic requests, so a second run on the same database shows them twice.
DOCS_RUN := cd frontend && DOCS=1 DEMO_PASSWORD="$${DEMO_PASSWORD:-$$(grep '^DEMO_PASSWORD=' ../.env | cut -d= -f2-)}" npx playwright test --project=docs --workers=1

screenshots: ## Regenerate the README screenshots in docs/images (fresh e2e stack)
	$(DOCS_RUN) e2e/docs/screenshots.spec.ts

demo-gif: ## Record the approval flow: docs/images/approval-flow.gif + local MP4 (fresh e2e stack, Docker)
	$(DOCS_RUN) e2e/docs/demo-video.spec.ts
	sh scripts/make_demo_media.sh

e2e-reset: ## Delete the end-to-end database only (never the demo one); run e2e-up again afterwards
	$(E2E) down --volumes

check: lint-api test-api schema-check lint-web test-web ## Full local quality gate
