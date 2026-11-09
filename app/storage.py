import json
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MEDIA_DIR = DATA_DIR / "media"
HISTORY_FILE = DATA_DIR / "history.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

_lock = threading.Lock()


def _read_all() -> List[Dict[str, Any]]:
    if not HISTORY_FILE.exists():
        return []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_all(items: List[Dict[str, Any]]) -> None:
    tmp_path = HISTORY_FILE.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, HISTORY_FILE)


def list_history() -> List[Dict[str, Any]]:
    with _lock:
        items = _read_all()
    summaries = []
    for item in items:
        analysis = item.get("analysis") or {}
        stats = analysis.get("stats") or {}
        summaries.append({
            "id": item.get("id"),
            "title": item.get("title") or item.get("filename"),
            "filename": item.get("filename"),
            "media_type": item.get("media_type", "audio"),
            "language": item.get("language", "es"),
            "language_name": item.get("language_name", "Español"),
            "model_size": item.get("model_size", "base"),
            "created_at": item.get("created_at"),
            "created_at_formatted": item.get("created_at_formatted"),
            "duration_formatted": stats.get("duration_formatted", "00:00"),
            "word_count": stats.get("word_count", 0),
            "preview": (analysis.get("executive_summary") or "")[:140],
        })
    return summaries


def get_item(item_id: str) -> Optional[Dict[str, Any]]:
    with _lock:
        items = _read_all()
        for item in items:
            if item.get("id") == item_id:
                return item
    return None


def save_item(item: Dict[str, Any]) -> Dict[str, Any]:
    with _lock:
        items = _read_all()
        existing_idx = next((i for i, x in enumerate(items) if x.get("id") == item.get("id")), None)
        if "created_at" not in item:
            now = datetime.now()
            item["created_at"] = now.isoformat()
            item["created_at_formatted"] = now.strftime("%d/%m/%Y %H:%M")
        if existing_idx is not None:
            items[existing_idx] = item
        else:
            items.insert(0, item)
        _write_all(items)
    return item


def delete_item(item_id: str) -> bool:
    with _lock:
        items = _read_all()
        target = next((x for x in items if x.get("id") == item_id), None)
        if not target:
            return False
        items = [x for x in items if x.get("id") != item_id]
        _write_all(items)

    media_file = target.get("stored_filename")
    if media_file:
        media_path = MEDIA_DIR / media_file
        if media_path.exists():
            try:
                media_path.unlink()
            except Exception:
                pass
    return True
