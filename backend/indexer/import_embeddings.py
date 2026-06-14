"""Bulk-index pre-computed NDJSON embedding files into OpenSearch.

Run this on YOUR machine (the one with OpenSearch) after your teammate has
produced NDJSON files with export_embeddings.py.

Each line of the NDJSON must be a JSON object containing all document fields
plus an "embedding" key holding the vector as a JSON array.  APPLICATION_ID
is used as the deterministic OpenSearch _id, so re-importing the same file is
a safe idempotent upsert.

Usage (from repo root, against local Docker OpenSearch):
    docker compose exec backend python indexer/import_embeddings.py \\
        /app/2020_data_embedded.ndjson \\
        /app/2021_data_embedded.ndjson

Or outside Docker (make sure OPENSEARCH_HOST / PORT are set):
    python indexer/import_embeddings.py batch2_embedded.ndjson batch3_embedded.ndjson

Env vars honoured (same as the rest of the indexer):
    OPENSEARCH_HOST   default: localhost
    OPENSEARCH_PORT   default: 9200
    OPENSEARCH_INDEX  default: project_data
    EMBEDDING_MODEL   default: sentence-transformers/all-MiniLM-L6-v2 (384-d vectors)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from opensearchpy.helpers import parallel_bulk  # noqa: E402

from api.opensearch_client import get_bulk_settings, get_client, get_index_name, get_timeout  # noqa: E402
from index_data import create_index  # noqa: E402

ID_FIELD = "APPLICATION_ID"
EMBEDDING_FIELD = "embedding"


def _actions(index_name: str, records: Iterator[dict[str, Any]]) -> Iterator[dict[str, Any]]:
  for record in records:
    doc_id = record.get(ID_FIELD)
    action: dict[str, Any] = {"_index": index_name, "_source": record}
    if doc_id is not None:
      action["_id"] = str(doc_id)
    yield action


def _iter_ndjson(path: Path) -> Iterator[dict[str, Any]]:
  with path.open("r", encoding="utf-8") as fh:
    for line_no, line in enumerate(fh, 1):
      line = line.strip()
      if not line:
        continue
      try:
        yield json.loads(line)
      except json.JSONDecodeError as exc:
        print(f"  Warning: skipping line {line_no} in {path}: {exc}", flush=True)


def _format_bulk_failure(item: object) -> str:
  if not isinstance(item, dict):
    return str(item)[:300]
  block = item.get("index")
  if not isinstance(block, dict):
    return str(item)[:300]
  doc_id = block.get("_id", "?")
  err = block.get("error", "unknown")
  return f"id={doc_id} error={err}"


def import_file(client: object, index_name: str, ndjson_path: Path) -> tuple[int, int]:
  """Bulk-index one NDJSON file; return (successes, failures)."""
  successes = 0
  failures = 0
  chunk_size, thread_count, queue_size = get_bulk_settings()

  records = _iter_ndjson(ndjson_path)

  for ok, item in parallel_bulk(
    client,  # type: ignore[arg-type]
    _actions(index_name, records),
    thread_count=thread_count,
    chunk_size=chunk_size,
    queue_size=queue_size,
    raise_on_error=False,
    raise_on_exception=False,
  ):
    if ok:
      successes += 1
      if successes % 5_000 == 0:
        print(f"  ...indexed {successes:,} records", flush=True)
    else:
      failures += 1
      if failures <= 5:
        print(f"  bulk error: {_format_bulk_failure(item)}", flush=True)
      elif failures == 6:
        print("  bulk errors continue (further details suppressed)", flush=True)

  return successes, failures


def main() -> None:
  parser = argparse.ArgumentParser(
    description="Bulk-index pre-embedded NDJSON files into the project_data index."
  )
  parser.add_argument(
    "ndjson_files",
    nargs="+",
    help="One or more NDJSON files produced by export_embeddings.py.",
  )
  args = parser.parse_args()

  client = get_client(http_compress=True)
  index_name = get_index_name()
  chunk_size, thread_count, queue_size = get_bulk_settings()
  print(
    f"Bulk settings: chunk_size={chunk_size}, threads={thread_count}, "
    f"queue={queue_size}, timeout={get_timeout()}s",
    flush=True,
  )

  # Ensure the index exists with the knn_vector mapping.
  # If it already exists this is a no-op (create_index checks before creating).
  create_index(client, index_name, with_embeddings=True)

  total_ok = 0
  total_fail = 0

  for raw_path in args.ndjson_files:
    path = Path(raw_path)
    if not path.exists():
      print(f"Error: file not found: {path}", file=sys.stderr)
      sys.exit(1)

    print(f"\nImporting '{path}' into '{index_name}'...")
    t0 = time.perf_counter()
    ok, fail = import_file(client, index_name, path)
    elapsed = time.perf_counter() - t0
    rate = ok / max(elapsed, 1e-6)
    print(
      f"  Done: {ok:,} indexed, {fail:,} failures in {elapsed:.1f}s ({rate:.0f} docs/s)."
    )
    total_ok += ok
    total_fail += fail

  print(f"\nAll files done. Total indexed: {total_ok:,}, total failures: {total_fail:,}.")


if __name__ == "__main__":
  main()
