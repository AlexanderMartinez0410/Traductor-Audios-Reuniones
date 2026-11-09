import mimetypes
import re
import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.analyzer import analyze_transcript
from app.exporter import export_to_docx, export_to_pdf, export_to_srt, export_to_txt
from app.storage import MEDIA_DIR, delete_item, get_item, list_history, save_item
from app.transcriber import get_language_name, transcribe_media_file, translate_segments

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="Sistema Audio Escrito - Transcriptor Local IA",
    description="Transcribe audios y videos a texto localmente con lector sincronizado, resumen y exportación.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".wmv", ".flv"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma", ".opus", ".webm"}

# Estado en memoria de trabajos de transcripción en curso
_active_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()


class UpdateItemRequest(BaseModel):
    title: Optional[str] = None
    segments: Optional[List[Dict[str, Any]]] = None
    executive_summary: Optional[str] = None


class TranslateItemRequest(BaseModel):
    target_language: str


def _safe_filename(name: str) -> str:
    stem = Path(name).stem
    clean = re.sub(r"[^\w\s-]", "", stem, flags=re.UNICODE).strip()
    clean = re.sub(r"[\s]+", "_", clean)
    return clean[:60] or "transcripcion"


def _run_transcription_job(
    job_id: str,
    item_id: str,
    media_path: Path,
    original_filename: str,
    stored_filename: str,
    media_type: str,
    model_size: str,
    language: str,
    translate_to: str,
) -> None:
    def on_progress(state: Dict[str, Any]) -> None:
        with _jobs_lock:
            if job_id in _active_jobs:
                _active_jobs[job_id].update(state)

    try:
        result = transcribe_media_file(
            file_path=str(media_path),
            model_size=model_size,
            language=language if language != "auto" else None,
            translate_to=translate_to if translate_to != "none" else None,
            progress_callback=on_progress,
        )

        on_progress({
            "status": "analyzing",
            "progress": 96,
            "message": "Generando párrafos de lectura, resumen ejecutivo y puntos clave...",
        })

        segments = result.get("segments", [])
        duration = result.get("duration", 0.0)
        analysis = analyze_transcript(segments, duration=duration)

        now = datetime.now()
        title_clean = Path(original_filename).stem.replace("_", " ").replace("-", " ").strip()
        if not title_clean:
            title_clean = "Grabación de Audio"

        item_data: Dict[str, Any] = {
            "id": item_id,
            "title": title_clean,
            "filename": original_filename,
            "stored_filename": stored_filename,
            "media_type": media_type,
            "model_size": model_size,
            "language": result.get("language", "es"),
            "original_language": result.get("original_language", "es"),
            "language_name": result.get("language_name", "Español"),
            "language_probability": result.get("language_probability", 1.0),
            "duration": duration,
            "processing_time_seconds": result.get("processing_time_seconds", 0.0),
            "created_at": now.isoformat(),
            "created_at_formatted": now.strftime("%d/%m/%Y %H:%M"),
            "segments": segments,
            "analysis": analysis,
        }

        save_item(item_data)

        with _jobs_lock:
            _active_jobs[job_id] = {
                "job_id": job_id,
                "status": "completed",
                "progress": 100,
                "message": "¡Transcripción completada con éxito!",
                "item_id": item_id,
                "item": item_data,
            }
    except Exception as exc:
        with _jobs_lock:
            _active_jobs[job_id] = {
                "job_id": job_id,
                "status": "error",
                "progress": 0,
                "message": f"Error al transcribir el archivo: {str(exc)}",
            }


@app.post("/api/transcribe")
async def start_transcription(
    file: UploadFile = File(...),
    model_size: str = Form("dsp_fast"),
    language: str = Form("es"),
    translate_to: str = Form("none"),
    media_kind: Optional[str] = Form(None),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No se recibió ningún archivo válido.")

    ext = Path(file.filename).suffix.lower()
    if not ext:
        ext = ".webm"

    item_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())
    stored_filename = f"{item_id}{ext}"
    media_path = MEDIA_DIR / stored_filename

    with open(media_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    if media_kind in ("audio", "video"):
        media_type = media_kind
    else:
        content_type = (file.content_type or "").lower()
        if content_type.startswith("video/") or ext in VIDEO_EXTENSIONS:
            media_type = "video"
        else:
            media_type = "audio"

    with _jobs_lock:
        _active_jobs[job_id] = {
            "job_id": job_id,
            "item_id": item_id,
            "status": "queued",
            "progress": 2,
            "message": "Archivo recibido. Iniciando procesamiento...",
            "segments_count": 0,
            "latest_text": "",
        }

    worker = threading.Thread(
        target=_run_transcription_job,
        args=(
            job_id,
            item_id,
            media_path,
            file.filename,
            stored_filename,
            media_type,
            model_size,
            language,
            translate_to,
        ),
        daemon=True,
    )
    worker.start()

    return {"job_id": job_id, "item_id": item_id}


@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    with _jobs_lock:
        job = _active_jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Trabajo no encontrado.")
        return dict(job)


@app.get("/api/history")
async def get_history_list():
    return {"items": list_history()}


@app.get("/api/items/{item_id}")
async def get_transcription_item(item_id: str):
    item = get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Transcripción no encontrada.")
    return item


@app.put("/api/items/{item_id}")
async def update_transcription_item(item_id: str, payload: UpdateItemRequest):
    item = get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Transcripción no encontrada.")

    if payload.title is not None:
        item["title"] = payload.title.strip() or item["title"]

    if payload.segments is not None:
        item["segments"] = payload.segments
        item["analysis"] = analyze_transcript(payload.segments, duration=item.get("duration", 0.0))

    if payload.executive_summary is not None:
        if "analysis" not in item or not isinstance(item["analysis"], dict):
            item["analysis"] = {}
        item["analysis"]["executive_summary"] = payload.executive_summary.strip()

    save_item(item)
    return item


@app.post("/api/items/{item_id}/translate")
async def translate_existing_item(item_id: str, payload: TranslateItemRequest):
    item = get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Transcripción no encontrada.")

    target = payload.target_language.strip().lower()
    segments = item.get("segments") or []

    # Si pide volver al texto original y existe original_text guardado:
    if target == "original":
        restored = []
        for s in segments:
            seg_copy = dict(s)
            if "original_text" in seg_copy:
                seg_copy["text"] = seg_copy["original_text"]
            restored.append(seg_copy)
        orig_lang = item.get("original_language", item.get("language", "es"))
        item["segments"] = restored
        item["language"] = orig_lang
        item["language_name"] = get_language_name(orig_lang)
        item["analysis"] = analyze_transcript(restored, duration=item.get("duration", 0.0))
        save_item(item)
        return item

    translated_segs = translate_segments(segments, source_lang="auto", target_lang=target)
    item["segments"] = translated_segs
    item["language"] = target
    item["language_name"] = get_language_name(target)
    item["analysis"] = analyze_transcript(translated_segs, duration=item.get("duration", 0.0))
    save_item(item)
    return item


@app.delete("/api/items/{item_id}")
async def remove_transcription_item(item_id: str):
    deleted = delete_item(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Transcripción no encontrada.")
    return {"ok": True}


@app.get("/api/media/{item_id}")
async def stream_media_file(item_id: str):
    item = get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Transcripción no encontrada.")

    stored_filename = item.get("stored_filename")
    if not stored_filename:
        raise HTTPException(status_code=404, detail="Archivo multimedia no asociado.")

    media_path = MEDIA_DIR / stored_filename
    if not media_path.exists():
        raise HTTPException(status_code=404, detail="Archivo multimedia no encontrado en disco.")

    mime_type, _ = mimetypes.guess_type(str(media_path))
    return FileResponse(
        path=str(media_path),
        media_type=mime_type or "application/octet-stream",
        filename=item.get("filename") or stored_filename,
    )


@app.get("/api/items/{item_id}/export/{fmt}")
async def export_item(
    item_id: str,
    fmt: str,
    timestamps: bool = Query(True, description="Incluir marcas de tiempo"),
    summary: bool = Query(True, description="Incluir resumen ejecutivo y puntos clave"),
):
    item = get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Transcripción no encontrada.")

    fmt_clean = fmt.lower().strip()
    base_name = _safe_filename(item.get("title") or item.get("filename") or "transcripcion")

    if fmt_clean == "txt":
        content_str = export_to_txt(item, include_timestamps=timestamps, include_summary=summary)
        return Response(
            content=content_str.encode("utf-8"),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{base_name}.txt"'},
        )
    elif fmt_clean == "srt":
        content_str = export_to_srt(item)
        return Response(
            content=content_str.encode("utf-8"),
            media_type="application/x-subrip; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{base_name}.srt"'},
        )
    elif fmt_clean == "docx":
        docx_bytes = export_to_docx(item, include_timestamps=timestamps)
        return Response(
            content=docx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{base_name}.docx"'},
        )
    elif fmt_clean == "pdf":
        pdf_bytes = export_to_pdf(item, include_timestamps=timestamps)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{base_name}.pdf"'},
        )
    else:
        raise HTTPException(status_code=400, detail="Formato no soportado. Usa txt, srt, docx o pdf.")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def serve_index():
    return FileResponse(str(STATIC_DIR / "index.html"))
