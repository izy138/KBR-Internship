"""OpenSearch client factory used by API modules."""

from __future__ import annotations

import os

from opensearchpy import OpenSearch


def _env_bool(name: str, *, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def get_timeout() -> int:
    raw = os.getenv("OPENSEARCH_TIMEOUT")
    if raw is not None:
        return int(raw)
    if _env_bool("OPENSEARCH_USE_SSL"):
        return 120
    return 10


def get_bulk_settings() -> tuple[int, int, int]:
    """Return (chunk_size, thread_count, queue_size) for parallel_bulk."""
    if _env_bool("OPENSEARCH_USE_SSL"):
        chunk = int(os.getenv("OPENSEARCH_BULK_CHUNK_SIZE", "50"))
        threads = int(os.getenv("OPENSEARCH_BULK_THREAD_COUNT", "2"))
        queue = int(os.getenv("OPENSEARCH_BULK_QUEUE_SIZE", "2"))
        return chunk, threads, queue
    chunk = int(os.getenv("OPENSEARCH_BULK_CHUNK_SIZE", "1000"))
    threads = int(os.getenv("OPENSEARCH_BULK_THREAD_COUNT", "8"))
    queue = int(os.getenv("OPENSEARCH_BULK_QUEUE_SIZE", "8"))
    return chunk, threads, queue


def get_client(*, http_compress: bool = False) -> OpenSearch:
    host = os.getenv("OPENSEARCH_HOST", "localhost")
    port = int(os.getenv("OPENSEARCH_PORT", "9200"))
    user = os.getenv("OPENSEARCH_USER")
    password = os.getenv("OPENSEARCH_PASSWORD")
    use_ssl = _env_bool("OPENSEARCH_USE_SSL")
    ca_certs = os.getenv("OPENSEARCH_CA_CERT")

    http_auth: tuple[str, str] | None = None
    if user and password:
        http_auth = (user, password)

    return OpenSearch(
        hosts=[{"host": host, "port": port}],
        http_compress=http_compress,
        http_auth=http_auth,
        use_ssl=use_ssl,
        verify_certs=use_ssl,
        ca_certs=ca_certs if use_ssl and ca_certs else None,
        ssl_assert_hostname=False,
        ssl_show_warn=False,
        timeout=get_timeout(),
    )


def get_index_name() -> str:
    return os.getenv("OPENSEARCH_INDEX", "project_data")
