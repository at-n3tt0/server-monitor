import json
import sqlite3
from pathlib import Path
from urllib.parse import urlparse


def load_legacy_config(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def extract_address_from_url(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    return parsed.hostname


def has_sqlite_table(db_path: Path, table_name: str) -> bool:
    if not db_path.exists():
        return False
    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table_name,),
        ).fetchone()
    return bool(row)
