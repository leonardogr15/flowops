# FlowOps developer commands. Requires Docker; frontend targets also need Node 22+.
COMPOSE := docker compose
API := $(COMPOSE) run --rm --no-deps -e DJANGO_SETTINGS_MODULE=config.settings.test api

.PHONY: help env up down logs demo migrations migrate test-api lint-api schema schema-check \
        web-install test-web lint-web e2e check

help: ## List targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-14s %s\n", $$1, $$2}'

env: ## Create .env with random local secrets (never overwrites)
	@test -f .env || python3 scripts/make_env.py

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

web-install:
	cd frontend && npm ci

test-web: ## Frontend unit/component tests
	cd frontend && npm test

lint-web: ## Frontend lint + type check
	cd frontend && npm run lint && npm run typecheck

e2e: ## Playwright against the running stack (export DEMO_PASSWORD first)
	cd frontend && npm run e2e

check: lint-api test-api schema-check lint-web test-web ## Full local quality gate
