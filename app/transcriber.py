import io
import json
import os
import threading
import time
import urllib.request
import wave
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import av
import numpy as np
import speech_recognition as sr
from deep_translator import GoogleTranslator

from app.analyzer import format_timestamp

BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "data" / "models"
VOSK_MODELS_DIR = MODELS_DIR / "vosk"
MODELS_DIR.mkdir(parents=True, exist_ok=True)
VOSK_MODELS_DIR.mkdir(parents=True, exist_ok=True)

SAMPLE_RATE = 16000

LANGUAGE_NAMES: Dict[str, str] = {
    "es": "Español",
    "en": "Inglés",
    "pt": "Portugués",
    "fr": "Francés",
    "it": "Italiano",
    "de": "Alemán",
    "ca": "Catalán",
    "gl": "Gallego",
    "eu": "Euskera",
    "nl": "Neerlandés",
    "ru": "Ruso",
    "zh": "Chino",
    "ja": "Japonés",
    "ko": "Coreano",
}

SPEECH_RECOGNITION_LOCALES: Dict[str, str] = {
    "es": "es-ES",
    "en": "en-US",
    "pt": "pt-BR",
    "fr": "fr-FR",
    "it": "it-IT",
    "de": "de-DE",
    "ca": "ca-ES",
    "gl": "gl-ES",
    "eu": "eu-ES",
    "nl": "nl-NL",
    "ru": "ru-RU",
    "zh": "zh-CN",
    "ja": "ja-JP",
    "ko": "ko-KR",
}

VOSK_MODEL_URLS: Dict[str, Tuple[str, str]] = {
    "es": (
        "vosk-model-small-es-0.42",
        "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip",
    ),
    "en": (
        "vosk-model-small-en-us-0.15",
        "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
    ),
    "pt": (
        "vosk-model-small-pt-0.3",
        "https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip",
    ),
    "fr": (
        "vosk-model-small-fr-0.22",
        "https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip",
    ),
    "it": (
        "vosk-model-small-it-0.22",
        "https://alphacephei.com/vosk/models/vosk-model-small-it-0.22.zip",
    ),
    "de": (
        "vosk-model-small-de-0.15",
        "https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip",
    ),
}

_loaded_whisper_models: Dict[str, Any] = {}
_loaded_vosk_models: Dict[str, Any] = {}
_model_lock = threading.Lock()


def get_language_name(code: Optional[str]) -> str:
    if not code or code == "auto":
        return "Español"
    return LANGUAGE_NAMES.get(code.lower(), code.upper())


# ============================================================================
# 1. PROCESAMIENTO DIGITAL DE SEÑALES (DSP): DECODIFICACIÓN Y SEGMENTACIÓN RMS
# ============================================================================

def decode_media_to_pcm16(file_path: str) -> Tuple[np.ndarray, float]:
    """
    Decodifica cualquier archivo de audio o video a una señal PCM mono de 16kHz (int16)
    aplicando normalización algorítmica de ganancia (Peak Normalization) para reuniones.
    Compatible con PyAV 19+ (no usa el argumento obsoleto metadata_errors).
    """
    container = av.open(file_path, mode="r")
    try:
        audio_streams = [s for s in container.streams if s.type == "audio"]
        if not audio_streams:
            raise ValueError("El archivo no contiene ninguna pista de audio.")

        stream = audio_streams[0]
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)

        chunks: List[np.ndarray] = []
        for frame in container.decode(stream):
            frame.pts = None
            resampled_frames = resampler.resample(frame)
            for r_frame in resampled_frames:
                arr = r_frame.to_ndarray().reshape(-1)
                chunks.append(arr)

        # Vaciar buffer final del resampler
        flushed_frames = resampler.resample(None)
        if flushed_frames:
            for r_frame in flushed_frames:
                arr = r_frame.to_ndarray().reshape(-1)
                chunks.append(arr)
    finally:
        container.close()

    if not chunks:
        return np.zeros(0, dtype=np.int16), 0.0

    pcm = np.concatenate(chunks).astype(np.int16)
    duration = float(len(pcm)) / float(SAMPLE_RATE)

    # Normalización algorítmica de amplitud (útil en reuniones con micrófonos lejanos)
    peak = int(np.max(np.abs(pcm))) if len(pcm) > 0 else 0
    if 100 < peak < 24000:
        gain = min(4.0, 28000.0 / float(peak))
        pcm = np.clip(pcm.astype(np.float32) * gain, -32767, 32767).astype(np.int16)

    return pcm, duration


def segment_audio_by_energy_dsp(
    pcm: np.ndarray,
    sample_rate: int = SAMPLE_RATE,
    min_segment_sec: float = 3.5,
    max_segment_sec: float = 14.0,
    min_silence_sec: float = 0.40,
) -> List[Dict[str, Any]]:
    """
    Algoritmo clásico de detección de actividad de voz (VAD por energía RMS y umbral adaptativo).
    Divide la señal de audio de una reunión en intervenciones naturales con marcas de tiempo exactas.
    """
    total_samples = len(pcm)
    if total_samples == 0:
        return []

    frame_ms = 30
    frame_len = int(sample_rate * frame_ms / 1000)  # 480 muestras a 16kHz
    num_frames = total_samples // frame_len
    if num_frames == 0:
        return [{
            "start": 0.0,
            "end": round(total_samples / sample_rate, 2),
            "pcm": pcm,
        }]

    # Calcular energía RMS por ventana de 30ms
    trimmed = pcm[: num_frames * frame_len].reshape(num_frames, frame_len).astype(np.float32)
    rms_frames = np.sqrt(np.mean(trimmed * trimmed, axis=1))

    # Umbral adaptativo entre el percentil 20 (ruido de sala) y la mediana de voz
    noise_floor = float(np.percentile(rms_frames, 20))
    voice_peak = float(np.percentile(rms_frames, 85))
    silence_threshold = max(180.0, noise_floor + (voice_peak - noise_floor) * 0.16)

    is_speech = rms_frames > silence_threshold
    min_silence_frames = max(1, int(round((min_silence_sec * 1000) / frame_ms)))
    min_seg_frames = max(1, int(round((min_segment_sec * 1000) / frame_ms)))
    max_seg_frames = max(min_seg_frames + 10, int(round((max_segment_sec * 1000) / frame_ms)))

    segments: List[Dict[str, Any]] = []
    in_speech = False
    seg_start_frame = 0
    silence_run = 0

    for i in range(num_frames):
        if is_speech[i]:
            if not in_speech:
                in_speech = True
                # Incluir un pequeño margen previo de 150ms para no cortar la primera consonante
                seg_start_frame = max(0, i - 5)
            silence_run = 0
        else:
            if in_speech:
                silence_run += 1

        current_len_frames = i - seg_start_frame + 1

        # Cortar si hay suficiente silencio tras hablar, o si alcanzamos el máximo de duración en una pausa breve
        should_cut = False
        if in_speech:
            if silence_run >= min_silence_frames and current_len_frames >= min_seg_frames:
                should_cut = True
            elif current_len_frames >= max_seg_frames and silence_run >= 3:
                should_cut = True
            elif current_len_frames >= int(max_seg_frames * 1.35):
                should_cut = True

        if should_cut:
            end_frame = min(num_frames, i + 2)
            s_sample = seg_start_frame * frame_len
            e_sample = min(total_samples, end_frame * frame_len)
            if e_sample - s_sample > int(sample_rate * 0.35):
                segments.append({
                    "start": round(s_sample / sample_rate, 2),
                    "end": round(e_sample / sample_rate, 2),
                    "pcm": pcm[s_sample:e_sample],
                })
            in_speech = False
            silence_run = 0

    # Agregar el último segmento pendiente si quedó voz al final
    if in_speech:
        s_sample = seg_start_frame * frame_len
        e_sample = total_samples
        if e_sample - s_sample > int(sample_rate * 0.35):
            segments.append({
                "start": round(s_sample / sample_rate, 2),
                "end": round(e_sample / sample_rate, 2),
                "pcm": pcm[s_sample:e_sample],
            })

    # Si todo el audio fue muy uniforme y no se detectaron cortes, dividir en bloques uniformes de 10s
    if not segments and total_samples > 0:
        step = sample_rate * 10
        for s in range(0, total_samples, step):
            e = min(total_samples, s + step)
            segments.append({
                "start": round(s / sample_rate, 2),
                "end": round(e / sample_rate, 2),
                "pcm": pcm[s:e],
            })

    return segments


def _format_sentence_text(raw_text: str) -> str:
    txt = raw_text.strip()
    if not txt:
        return ""
    txt = txt[0].upper() + txt[1:]
    if not txt.endswith((".", "!", "?", "…")):
        txt += "."
    return txt


# ============================================================================
# 2. MOTOR 1: ALGORÍTMICO / ACÚSTICO DIRECTO (SPEECHRECOGNITION + DSP RMS)
# ============================================================================

def _transcribe_with_dsp_speech_recognition(
    pcm: np.ndarray,
    duration: float,
    language: str,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Tuple[List[Dict[str, Any]], str]:
    lang_code = language if (language and language != "auto") else "es"
    sr_locale = SPEECH_RECOGNITION_LOCALES.get(lang_code, "es-ES")

    if progress_callback:
        progress_callback({
            "status": "transcribing",
            "progress": 15,
            "message": "Segmentando reunión por energía acústica (algoritmo DSP RMS)...",
            "segments_count": 0,
            "latest_text": "",
        })

    raw_chunks = segment_audio_by_energy_dsp(pcm, SAMPLE_RATE)
    total_chunks = max(len(raw_chunks), 1)

    recognizer = sr.Recognizer()

    def _recognize_single_chunk(idx: int, chunk: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        pcm_bytes = chunk["pcm"].tobytes()
        audio_data = sr.AudioData(pcm_bytes, SAMPLE_RATE, 2)
        for attempt in range(2):
            try:
                text = recognizer.recognize_google(audio_data, language=sr_locale)
                if text and text.strip():
                    formatted = _format_sentence_text(text)
                    return {
                        "idx": idx,
                        "start": chunk["start"],
                        "end": chunk["end"],
                        "timestamp": format_timestamp(chunk["start"]),
                        "text": formatted,
                    }
                return None
            except sr.UnknownValueError:
                return None
            except Exception:
                if attempt == 0:
                    time.sleep(0.3)
        return None

    completed_results: List[Dict[str, Any]] = []
    done_count = 0

    # Procesar hasta 4 fragmentos acústicos en paralelo para máxima velocidad en reuniones largas
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(_recognize_single_chunk, idx, chunk): idx
            for idx, chunk in enumerate(raw_chunks)
        }
        for fut in as_completed(futures):
            done_count += 1
            res = fut.result()
            if res:
                completed_results.append(res)
            if progress_callback:
                pct = int(18 + (done_count / total_chunks) * 72)
                latest_txt = res["text"] if res else ""
                progress_callback({
                    "status": "transcribing",
                    "progress": min(90, pct),
                    "message": f"Procesando bloque acústico {done_count} de {total_chunks}...",
                    "segments_count": len(completed_results),
                    "latest_text": latest_txt,
                })

    completed_results.sort(key=lambda x: x["idx"])
    final_segments: List[Dict[str, Any]] = []
    for i, item in enumerate(completed_results, start=1):
        final_segments.append({
            "id": i,
            "start": item["start"],
            "end": item["end"],
            "timestamp": item["timestamp"],
            "text": item["text"],
        })

    return final_segments, lang_code


# ============================================================================
# 3. MOTOR 2: ALGORITMO ESTADÍSTICO OFFLINE KALDI / VOSK (HMM + WFST)
# ============================================================================

def _ensure_vosk_model(lang_code: str, progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None):
    from vosk import Model, SetLogLevel

    SetLogLevel(-1)
    if lang_code not in VOSK_MODEL_URLS:
        lang_code = "es"

    folder_name, url = VOSK_MODEL_URLS[lang_code]
    target_dir = VOSK_MODELS_DIR / folder_name

    with _model_lock:
        if lang_code in _loaded_vosk_models:
            return _loaded_vosk_models[lang_code], lang_code

        if not target_dir.exists():
            zip_path = VOSK_MODELS_DIR / f"{folder_name}.zip"
            if progress_callback:
                progress_callback({
                    "status": "loading_model",
                    "progress": 10,
                    "message": f"Descargando diccionario fonético Kaldi/Vosk ({lang_code.upper()}, ~45 MB) por única vez...",
                    "segments_count": 0,
                    "latest_text": "",
                })
            urllib.request.urlretrieve(url, str(zip_path))
            with zipfile.ZipFile(str(zip_path), "r") as zf:
                zf.extractall(str(VOSK_MODELS_DIR))
            try:
                zip_path.unlink()
            except Exception:
                pass

        model_instance = Model(str(target_dir))
        _loaded_vosk_models[lang_code] = model_instance
        return model_instance, lang_code


def _transcribe_with_vosk_kaldi(
    pcm: np.ndarray,
    duration: float,
    language: str,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Tuple[List[Dict[str, Any]], str]:
    from vosk import KaldiRecognizer

    lang_code = language if (language and language != "auto") else "es"
    vosk_model, lang_code = _ensure_vosk_model(lang_code, progress_callback=progress_callback)

    rec = KaldiRecognizer(vosk_model, SAMPLE_RATE)
    rec.SetWords(True)

    segments_list: List[Dict[str, Any]] = []
    step_samples = SAMPLE_RATE * 2  # Procesar de a 2 segundos
    total_samples = len(pcm)

    def _extract_segment_from_vosk_json(res_json: str) -> None:
        data = json.loads(res_json)
        txt = (data.get("text") or "").strip()
        if not txt:
            return
        words = data.get("result") or []
        if words:
            seg_start = round(float(words[0].get("start", 0.0)), 2)
            seg_end = round(float(words[-1].get("end", seg_start + 1.0)), 2)
        else:
            seg_start = 0.0
            seg_end = round(duration, 2)

        segments_list.append({
            "id": len(segments_list) + 1,
            "start": seg_start,
            "end": seg_end,
            "timestamp": format_timestamp(seg_start),
            "text": _format_sentence_text(txt),
        })

    for offset in range(0, total_samples, step_samples):
        chunk_bytes = pcm[offset : offset + step_samples].tobytes()
        if rec.AcceptWaveform(chunk_bytes):
            _extract_segment_from_vosk_json(rec.Result())
            if progress_callback:
                cur_sec = offset / SAMPLE_RATE
                pct = int(15 + min(0.95, cur_sec / max(duration, 1.0)) * 75)
                latest_txt = segments_list[-1]["text"] if segments_list else ""
                progress_callback({
                    "status": "transcribing",
                    "progress": pct,
                    "message": f"Decodificando fonemas Kaldi [{format_timestamp(cur_sec)} / {format_timestamp(duration)}]...",
                    "segments_count": len(segments_list),
                    "latest_text": latest_txt,
                })

    _extract_segment_from_vosk_json(rec.FinalResult())
    return segments_list, lang_code


# ============================================================================
# 4. MOTOR 3 (OPCIONAL): FASTER-WHISPER CORREGIDO (RECIBE PCM EN MEMORIA)
# ============================================================================

def _transcribe_with_whisper_fixed(
    pcm: np.ndarray,
    duration: float,
    model_size: str,
    language: Optional[str],
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Tuple[List[Dict[str, Any]], str]:
    from faster_whisper import WhisperModel

    real_size = model_size.replace("whisper_", "") if model_size.startswith("whisper_") else "base"
    if real_size not in {"tiny", "base", "small", "medium"}:
        real_size = "base"

    with _model_lock:
        if real_size not in _loaded_whisper_models:
            cpu_threads = max(2, (os.cpu_count() or 4) - 1)
            _loaded_whisper_models[real_size] = WhisperModel(
                real_size,
                device="cpu",
                compute_type="int8",
                cpu_threads=cpu_threads,
                download_root=str(MODELS_DIR),
            )
        model = _loaded_whisper_models[real_size]

    # Convertir int16 PCM a float32 normalizado [-1.0, 1.0] para evitar que faster-whisper llame a av.open(metadata_errors=...)
    audio_float32 = pcm.astype(np.float32) / 32768.0
    lang_arg = language if (language and language != "auto") else None

    segments_gen, info = model.transcribe(
        audio_float32,
        language=lang_arg,
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
    )

    detected_lang = getattr(info, "language", lang_arg or "es")
    segments_list: List[Dict[str, Any]] = []

    for seg in segments_gen:
        text_clean = seg.text.strip()
        if not text_clean:
            continue
        seg_start = round(float(seg.start), 2)
        seg_end = round(float(seg.end), 2)
        segments_list.append({
            "id": len(segments_list) + 1,
            "start": seg_start,
            "end": seg_end,
            "timestamp": format_timestamp(seg_start),
            "text": text_clean,
        })
        if progress_callback and duration > 0:
            pct = int(15 + min(0.95, seg_end / duration) * 75)
            progress_callback({
                "status": "transcribing",
                "progress": pct,
                "message": f"Transcribiendo [{format_timestamp(seg_end)} / {format_timestamp(duration)}]...",
                "segments_count": len(segments_list),
                "latest_text": text_clean,
            })

    return segments_list, detected_lang


# ============================================================================
# FUNCIÓN PRINCIPAL DE TRANSCRIPCIÓN
# ============================================================================

def transcribe_media_file(
    file_path: str,
    model_size: str = "dsp_fast",
    language: Optional[str] = "es",
    translate_to: Optional[str] = None,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """
    Decodifica la señal de audio (compatible con cualquier formato de audio/video) y
    ejecuta el motor de transcripción seleccionado:
      - 'dsp_fast': Segmentación algorítmica por energía RMS (DSP) + Reconocedor acústico directo (sin IA generativa)
      - 'vosk_offline': Reconocedor estadístico Kaldi/Vosk (HMM + WFST, 100% offline, sin IA generativa)
      - 'whisper_base' / 'whisper_small': Motor local Faster-Whisper (con el bug de PyAV 19 corregido)
    """
    start_wall = time.time()

    if progress_callback:
        progress_callback({
            "status": "loading_model",
            "progress": 6,
            "message": "Extrayendo y normalizando señal acústica (PCM 16kHz Mono)...",
            "segments_count": 0,
            "latest_text": "",
        })

    pcm, total_duration = decode_media_to_pcm16(file_path)

    if model_size == "vosk_offline":
        segments_list, detected_lang = _transcribe_with_vosk_kaldi(
            pcm=pcm,
            duration=total_duration,
            language=language or "es",
            progress_callback=progress_callback,
        )
    elif model_size.startswith("whisper"):
        segments_list, detected_lang = _transcribe_with_whisper_fixed(
            pcm=pcm,
            duration=total_duration,
            model_size=model_size,
            language=language,
            progress_callback=progress_callback,
        )
    else:
        # Por defecto: Algoritmo DSP de Energía Acústica + Reconocimiento Fonético Directo
        segments_list, detected_lang = _transcribe_with_dsp_speech_recognition(
            pcm=pcm,
            duration=total_duration,
            language=language or "es",
            progress_callback=progress_callback,
        )
        # Si por falta de internet en ese instante no devolvió segmentos, cae automáticamente a Vosk Offline
        if not segments_list and len(pcm) > SAMPLE_RATE:
            segments_list, detected_lang = _transcribe_with_vosk_kaldi(
                pcm=pcm,
                duration=total_duration,
                language=language or "es",
                progress_callback=progress_callback,
            )

    translated_lang_code = None
    if translate_to and translate_to not in ("none", "", detected_lang):
        if progress_callback:
            progress_callback({
                "status": "translating",
                "progress": 92,
                "message": f"Traduciendo texto a {get_language_name(translate_to)}...",
                "segments_count": len(segments_list),
            })
        segments_list = translate_segments(segments_list, source_lang="auto", target_lang=translate_to)
        translated_lang_code = translate_to

    elapsed = round(time.time() - start_wall, 2)
    final_lang = translated_lang_code or detected_lang

    return {
        "language": final_lang,
        "original_language": detected_lang,
        "language_name": get_language_name(final_lang),
        "language_probability": 1.0,
        "duration": round(total_duration, 2),
        "processing_time_seconds": elapsed,
        "segments": segments_list,
    }


def translate_segments(
    segments: List[Dict[str, Any]],
    source_lang: str = "auto",
    target_lang: str = "es",
) -> List[Dict[str, Any]]:
    if not segments:
        return []

    translator = GoogleTranslator(source=source_lang, target=target_lang)
    translated_segments: List[Dict[str, Any]] = [dict(s) for s in segments]

    batch_indices: List[int] = []
    batch_texts: List[str] = []
    current_len = 0

    def _flush_batch(indices: List[int], texts: List[str]) -> None:
        if not indices:
            return
        try:
            joined = "\n".join(texts)
            result = translator.translate(joined)
            split_lines = [line.strip() for line in result.split("\n") if line.strip()]
            if len(split_lines) == len(indices):
                for i, line in zip(indices, split_lines):
                    translated_segments[i]["original_text"] = translated_segments[i].get(
                        "original_text", translated_segments[i]["text"]
                    )
                    translated_segments[i]["text"] = line
            else:
                for i, orig in zip(indices, texts):
                    translated_segments[i]["original_text"] = translated_segments[i].get(
                        "original_text", translated_segments[i]["text"]
                    )
                    translated_segments[i]["text"] = translator.translate(orig)
        except Exception:
            pass

    for idx, seg in enumerate(translated_segments):
        txt = seg.get("text", "").strip().replace("\n", " ")
        if not txt:
            continue
        if current_len + len(txt) > 3200 and batch_indices:
            _flush_batch(batch_indices, batch_texts)
            batch_indices = []
            batch_texts = []
            current_len = 0
        batch_indices.append(idx)
        batch_texts.append(txt)
        current_len += len(txt) + 2

    if batch_indices:
        _flush_batch(batch_indices, batch_texts)

    return translated_segments
