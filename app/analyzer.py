import math
import re
from collections import Counter
from typing import Any, Dict, List

STOPWORDS = {
    # Español
    "el", "la", "los", "las", "un", "una", "unos", "unas", "lo", "al", "del",
    "de", "en", "por", "para", "con", "sin", "sobre", "entre", "hacia", "hasta",
    "desde", "durante", "mediante", "según", "contra", "ante", "bajo", "tras",
    "y", "e", "o", "u", "ni", "que", "pero", "mas", "sino", "aunque", "como",
    "cuando", "donde", "quien", "cual", "cuyo", "porque", "pues", "si", "no",
    "ya", "muy", "más", "menos", "tan", "tanto", "todo", "toda", "todos", "todas",
    "otro", "otra", "otros", "otras", "mismo", "misma", "mismos", "mismas",
    "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas", "aquel",
    "aquella", "aquellos", "aquellas", "esto", "eso", "aquello", "mi", "mis",
    "tu", "tus", "su", "sus", "nuestro", "nuestra", "nuestros", "nuestras",
    "yo", "tú", "vos", "él", "ella", "ello", "nosotros", "nosotras", "ustedes",
    "ellos", "ellas", "me", "te", "se", "nos", "os", "le", "les", "sí", "conmigo",
    "ser", "soy", "eres", "es", "somos", "son", "era", "eran", "fue", "fueron",
    "sea", "sean", "sido", "estar", "estoy", "está", "estamos", "están", "estaba",
    "estuvieron", "estado", "haber", "he", "has", "ha", "hay", "hemos", "han",
    "había", "hubo", "habido", "tener", "tengo", "tiene", "tenemos", "tienen",
    "tenía", "tuvo", "hacer", "hago", "hace", "hacemos", "hacen", "hizo", "hecho",
    "ir", "voy", "va", "vamos", "van", "iba", "fueron", "poder", "puedo", "puede",
    "podemos", "pueden", "podía", "pudo", "decir", "digo", "dice", "dicen", "dijo",
    "ver", "veo", "ve", "vemos", "ven", "dar", "doy", "da", "dan", "dio",
    "también", "así", "bien", "mal", "aquí", "ahí", "allí", "acá", "allá",
    "ahora", "antes", "después", "luego", "entonces", "siempre", "nunca", "jamás",
    "quizás", "tal", "vez", "solo", "sólo", "cada", "alguno", "alguna", "algunos",
    "algunas", "ninguno", "ninguna", "algo", "nada", "alguien", "nadie", "cualquier",
    "bueno", "buena", "buenos", "buenas", "gran", "grande", "grandes", "poco",
    "poca", "pocos", "pocas", "mucho", "mucha", "muchos", "muchas", "eh", "ah",
    "mm", "este", "pues", "osea", "digamos", "entonces", "claro", "verdad",
    # Inglés
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for",
    "not", "on", "with", "he", "as", "you", "do", "at", "this", "but", "his",
    "by", "from", "they", "we", "say", "her", "she", "or", "an", "will", "my",
    "one", "all", "would", "there", "their", "what", "so", "up", "out", "if",
    "about", "who", "get", "which", "go", "me", "when", "make", "can", "like",
    "time", "no", "just", "him", "know", "take", "people", "into", "year", "your",
    "good", "some", "could", "them", "see", "other", "than", "then", "now", "look",
    "only", "come", "its", "over", "think", "also", "back", "after", "use", "two",
    "how", "our", "work", "first", "well", "way", "even", "new", "want", "because",
    "any", "these", "give", "day", "most", "us", "is", "are", "was", "were", "been",
    "has", "had", "did", "does", "uh", "um", "yeah", "okay", "right",
}


def format_timestamp(seconds: float) -> str:
    seconds = max(0, int(round(seconds)))
    hrs = seconds // 3600
    mins = (seconds % 3600) // 60
    secs = seconds % 60
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def tokenize_words(text: str) -> List[str]:
    words = re.findall(r"[a-záéíóúüñA-ZÁÉÍÓÚÜÑ]{3,}", text.lower())
    return [w for w in words if w not in STOPWORDS]


def generate_Reader_paragraphs(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Agrupa los segmentos cortos en párrafos naturales de lectura (de ~45 a 90 palabras
    o cuando hay una pausa larga > 1.8 segundos) manteniendo el timestamp de inicio y fin.
    """
    if not segments:
        return []

    paragraphs: List[Dict[str, Any]] = []
    current_texts: List[str] = []
    current_segment_ids: List[int] = []
    start_time = segments[0].get("start", 0.0)
    end_time = segments[0].get("end", 0.0)
    word_count = 0

    for idx, seg in enumerate(segments):
        text = seg.get("text", "").strip()
        if not text:
            continue

        seg_start = float(seg.get("start", 0.0))
        seg_end = float(seg.get("end", seg_start))
        pause = seg_start - end_time if current_texts else 0.0

        if not current_texts:
            start_time = seg_start

        current_texts.append(text)
        current_segment_ids.append(seg.get("id", idx))
        end_time = seg_end
        word_count += len(text.split())

        ends_sentence = text.endswith((".", "!", "?", "…"))
        should_split = (
            (word_count >= 55 and ends_sentence)
            or word_count >= 95
            or (pause > 2.0 and word_count >= 25 and ends_sentence)
        )

        if should_split:
            paragraphs.append({
                "start": round(start_time, 2),
                "end": round(end_time, 2),
                "timestamp": format_timestamp(start_time),
                "text": " ".join(current_texts),
                "segment_ids": current_segment_ids[:],
            })
            current_texts = []
            current_segment_ids = []
            word_count = 0

    if current_texts:
        paragraphs.append({
            "start": round(start_time, 2),
            "end": round(end_time, 2),
            "timestamp": format_timestamp(start_time),
            "text": " ".join(current_texts),
            "segment_ids": current_segment_ids[:],
        })

    return paragraphs


def analyze_transcript(
    segments: List[Dict[str, Any]],
    duration: float = 0.0,
) -> Dict[str, Any]:
    """
    Genera estadísticas, palabras clave, resumen ejecutivo, puntos clave con timestamps
    y desglose por bloques temáticos de forma 100% local.
    """
    if not segments:
        return {
            "stats": {
                "word_count": 0,
                "char_count": 0,
                "segment_count": 0,
                "duration_seconds": 0,
                "duration_formatted": "00:00",
                "wpm": 0,
                "reading_time_minutes": 0,
            },
            "executive_summary": "No se detectó contenido de voz en el archivo.",
            "key_points": [],
            "keywords": [],
            "questions": [],
            "sections": [],
            "paragraphs": [],
        }

    full_text = " ".join(s.get("text", "").strip() for s in segments if s.get("text", "").strip())
    all_words = full_text.split()
    word_count = len(all_words)
    char_count = len(full_text)

    if duration <= 0 and segments:
        duration = float(segments[-1].get("end", 0.0))

    minutes_audio = max(duration / 60.0, 0.1)
    wpm = int(round(word_count / minutes_audio)) if duration > 0 else 0
    reading_time_minutes = max(1, int(math.ceil(word_count / 200.0))) if word_count > 0 else 0

    # 1. Palabras clave más frecuentes
    content_tokens = tokenize_words(full_text)
    word_freq = Counter(content_tokens)
    top_keywords = [
        {"word": word.capitalize(), "count": count}
        for word, count in word_freq.most_common(12)
        if count >= 2 or len(word_freq) <= 8
    ][:10]

    # 2. Párrafos naturales para modo lectura y análisis de oraciones
    paragraphs = generate_Reader_paragraphs(segments)

    # 3. Construir unidades candidatas para resumen y puntos clave
    # Combinamos segmentos cortos en oraciones completas con su marca de tiempo
    sentence_units: List[Dict[str, Any]] = []
    buf_text: List[str] = []
    buf_start = 0.0
    buf_end = 0.0

    for seg in segments:
        t = seg.get("text", "").strip()
        if not t:
            continue
        if not buf_text:
            buf_start = float(seg.get("start", 0.0))
        buf_text.append(t)
        buf_end = float(seg.get("end", buf_start))
        joined = " ".join(buf_text)
        if t.endswith((".", "!", "?")) or len(joined.split()) >= 22:
            sentence_units.append({
                "start": buf_start,
                "end": buf_end,
                "timestamp": format_timestamp(buf_start),
                "text": joined,
            })
            buf_text = []

    if buf_text:
        sentence_units.append({
            "start": buf_start,
            "end": buf_end,
            "timestamp": format_timestamp(buf_start),
            "text": " ".join(buf_text),
        })

    # Puntuar cada oración por relevancia (TF-IDF + posición + longitud óptima)
    max_freq = max(word_freq.values()) if word_freq else 1
    norm_freq = {w: c / max_freq for w, c in word_freq.items()}

    scored_units: List[Dict[str, Any]] = []
    total_units = max(len(sentence_units), 1)

    for idx, unit in enumerate(sentence_units):
        tokens = tokenize_words(unit["text"])
        words_in_unit = len(unit["text"].split())
        if words_in_unit < 5:
            score = 0.1
        else:
            tf_score = sum(norm_freq.get(t, 0.0) for t in set(tokens)) / (math.sqrt(len(tokens)) + 1.0)
            # Bonus ligero a introducción y conclusión
            pos_ratio = idx / total_units
            pos_bonus = 1.15 if (pos_ratio < 0.15 or pos_ratio > 0.85) else 1.0
            # Penalizar oraciones demasiado largas o demasiado cortas
            len_bonus = 1.1 if 10 <= words_in_unit <= 38 else 0.85
            score = tf_score * pos_bonus * len_bonus

        scored_units.append({**unit, "score": score, "index": idx})

    # Seleccionar las mejores oraciones para el Resumen Ejecutivo (ordenadas cronológicamente)
    num_summary_sentences = min(max(2, len(scored_units) // 5), 5)
    top_for_summary = sorted(scored_units, key=lambda x: x["score"], reverse=True)[:num_summary_sentences]
    top_for_summary.sort(key=lambda x: x["index"])

    if top_for_summary:
        executive_summary = " ".join(u["text"] for u in top_for_summary)
    else:
        executive_summary = full_text[:500]

    # Seleccionar Puntos Clave distribuidos a lo largo del audio/video
    num_keypoints = min(max(3, len(scored_units) // 3), 8)
    top_for_keypoints = sorted(scored_units, key=lambda x: x["score"], reverse=True)[:num_keypoints]
    top_for_keypoints.sort(key=lambda x: x["index"])

    key_points = [
        {
            "timestamp": u["timestamp"],
            "start": round(u["start"], 2),
            "text": u["text"],
        }
        for u in top_for_keypoints
    ]

    # 4. Detectar preguntas o frases destacadas
    questions: List[Dict[str, Any]] = []
    question_starters = (
        "¿", "qué ", "cómo ", "cuándo ", "dónde ", "por qué ", "quién ", "cuál ",
        "what ", "how ", "why ", "when ", "where ", "who ", "which "
    )
    for u in sentence_units:
        txt_lower = u["text"].strip().lower()
        if "?" in u["text"] or txt_lower.startswith(question_starters):
            questions.append({
                "timestamp": u["timestamp"],
                "start": round(u["start"], 2),
                "text": u["text"],
            })

    # 5. Dividir en secciones temáticas por bloques de tiempo (cada ~2 minutos o mínimo 3 bloques si dura > 3 min)
    sections: List[Dict[str, Any]] = []
    if paragraphs:
        target_block_sec = 120.0 if duration >= 240 else max(60.0, duration / 3.0 if duration > 90 else duration + 1)
        block_paras: List[Dict[str, Any]] = []
        block_start = paragraphs[0]["start"]

        for p in paragraphs:
            if not block_paras:
                block_start = p["start"]
            block_paras.append(p)
            if (p["end"] - block_start) >= target_block_sec and len(block_paras) >= 1:
                block_text = " ".join(bp["text"] for bp in block_paras)
                block_tokens = Counter(tokenize_words(block_text)).most_common(3)
                topic_title = ", ".join(w.capitalize() for w, _ in block_tokens) if block_tokens else "Sección general"
                sections.append({
                    "title": f"Tema: {topic_title}",
                    "start": round(block_start, 2),
                    "end": round(p["end"], 2),
                    "timestamp_range": f"{format_timestamp(block_start)} - {format_timestamp(p['end'])}",
                    "summary": block_paras[0]["text"][:220] + ("..." if len(block_paras[0]["text"]) > 220 else ""),
                })
                block_paras = []

        if block_paras:
            block_text = " ".join(bp["text"] for bp in block_paras)
            block_tokens = Counter(tokenize_words(block_text)).most_common(3)
            topic_title = ", ".join(w.capitalize() for w, _ in block_tokens) if block_tokens else "Conclusión / Cierre"
            sections.append({
                "title": f"Tema: {topic_title}",
                "start": round(block_start, 2),
                "end": round(block_paras[-1]["end"], 2),
                "timestamp_range": f"{format_timestamp(block_start)} - {format_timestamp(block_paras[-1]['end'])}",
                "summary": block_paras[0]["text"][:220] + ("..." if len(block_paras[0]["text"]) > 220 else ""),
            })

    return {
        "stats": {
            "word_count": word_count,
            "char_count": char_count,
            "segment_count": len(segments),
            "duration_seconds": round(duration, 2),
            "duration_formatted": format_timestamp(duration),
            "wpm": wpm,
            "reading_time_minutes": reading_time_minutes,
        },
        "executive_summary": executive_summary,
        "key_points": key_points,
        "keywords": top_keywords,
        "questions": questions[:10],
        "sections": sections,
        "paragraphs": paragraphs,
    }
