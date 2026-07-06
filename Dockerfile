# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Renewals Studio — container build
# ---------------------------------------------------------------------------
# Mirrors the Signal CX Dockerfile pattern so the same App Foundry / Vibe
# infrastructure can host this app without surprises.
#
# Stack: Python 3.12-slim + FastAPI + asyncpg
# Target: Google Cloud Run via App Foundry / Vibe with Cloud SQL Postgres
# ---------------------------------------------------------------------------

############################
# Stage 1 — builder
############################
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /build

# Build deps for asyncpg's C extensions. Removed at the end of this stage —
# they never reach the runtime image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --prefix=/install -r requirements.txt

COPY app        ./app
COPY migrations ./migrations
COPY seeds      ./seeds
COPY public     ./public


############################
# Stage 2 — runtime
############################
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    HOST=0.0.0.0 \
    LOG_LEVEL=INFO \
    # Sensible defaults matching the Signal CX convention. Override in
    # production via the platform's secret manager.
    PGPASSWORD=signal \
    ADMIN_TOKEN=signal

# tini handles PID-1 signal forwarding so Cloud Run's SIGTERM reaches uvicorn
# for graceful drain. We deliberately do NOT install curl — the healthcheck
# uses Python's urllib so we save the package + reduce image size.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 app \
 && useradd  --system --uid 10001 --gid app --home /home/app --shell /usr/sbin/nologin app \
 && mkdir -p /app /home/app && chown -R app:app /app /home/app

WORKDIR /app

COPY --from=builder /install /usr/local
COPY --from=builder /build/app        /app/app
COPY --from=builder /build/migrations /app/migrations
COPY --from=builder /build/seeds      /app/seeds
COPY --from=builder /build/public     /app/public

USER app:app

EXPOSE 8080

# /healthz returns 200 once the process is alive — even before the DB pool
# is connected. --start-period=120s gives Cloud Run a generous grace window
# for cold-start initialisation (especially when Cloud SQL is itself warming).
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import urllib.request,os,sys; \
                 r=urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8080\")}/healthz', timeout=3); \
                 sys.exit(0 if r.status==200 else 1)" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]

# uvicorn flags:
#   --host / --port                       bind every interface at the platform port
#   --proxy-headers / --forwarded-allow-ips '*'   trust Cloud Run's edge for client IP
#   --timeout-graceful-shutdown 25        drain in-flight requests before SIGKILL
CMD ["sh", "-c", "exec uvicorn app.main:app --host ${HOST:-0.0.0.0} --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips=* --timeout-graceful-shutdown 25"]
