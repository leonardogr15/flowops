# syntax=docker/dockerfile:1
FROM python:3.14-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"
COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /usr/local/bin/uv
RUN groupadd --system app && useradd --system --gid app --home /app app
WORKDIR /app

# Development / test image: includes dev tools, source is bind-mounted by compose.
FROM base AS dev
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project
COPY --chown=app:app . .
USER app
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

# Production image: runtime dependencies only, non-root, gunicorn.
FROM base AS runtime
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY --chown=app:app . .
RUN DJANGO_SETTINGS_MODULE=config.settings.prod DJANGO_SECRET_KEY=collectstatic-only POSTGRES_PASSWORD=unused \
    python manage.py collectstatic --noinput
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/live').status==200 else 1)"
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
