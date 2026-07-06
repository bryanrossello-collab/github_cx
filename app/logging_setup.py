"""
Structured JSON logging — one event per line, written to stdout so Cloud Run's
log scraper picks them up.

Usage:
    from app.logging_setup import configure_logging, get_logger
    configure_logging()
    log = get_logger(__name__)
    log.info("db_connect_attempt", host=cfg.db_host, attempt=3)
"""

from __future__ import annotations

import logging
import sys

import structlog


def configure_logging(level: str = "INFO") -> None:
    """Configure both stdlib logging and structlog to emit JSON to stdout."""

    log_level = getattr(logging, level.upper(), logging.INFO)

    # Tame the standard noisemakers we don't care about at INFO.
    for noisy in ("asyncio", "asyncpg", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(max(log_level, logging.WARNING))

    # Stdlib root: send to stdout as-is. structlog will format below.
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
        force=True,
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True, key="ts"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "app") -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
