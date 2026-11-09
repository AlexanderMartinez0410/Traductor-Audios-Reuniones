import io
import os
from datetime import datetime
from typing import Any, Dict, List

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor
from fpdf import FPDF


def format_srt_timestamp(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        millis = 999
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"


def format_mmss(seconds: float) -> str:
    seconds = max(0, int(round(seconds)))
    hrs = seconds // 3600
    mins = (seconds % 3600) // 60
    secs = seconds % 60
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def export_to_txt(item: Dict[str, Any], include_timestamps: bool = True, include_summary: bool = True) -> str:
    lines: List[str] = []
    title = item.get("title") or item.get("filename") or "Transcripción"
    lines.append("=" * 68)
    lines.append(f"TRANSCRIPCIÓN: {title}")
    lines.append("=" * 68)
    lines.append(f"Fecha: {item.get('created_at_formatted', datetime.now().strftime('%Y-%m-%d %H:%M'))}")
    lines.append(f"Idioma detectado: {item.get('language_name', item.get('language', 'Auto'))}")

    analysis = item.get("analysis") or {}
    stats = analysis.get("stats") or {}
    if stats:
        lines.append(
            f"Duración: {stats.get('duration_formatted', '00:00')} | "
            f"Palabras: {stats.get('word_count', 0)} | "
            f"Tiempo de lectura: ~{stats.get('reading_time_minutes', 1)} min"
        )
    lines.append("-" * 68)
    lines.append("")

    if include_summary and analysis:
        summary = analysis.get("executive_summary", "")
        if summary:
            lines.append("RESUMEN EJECUTIVO")
            lines.append("-" * 25)
            lines.append(summary)
            lines.append("")

        key_points = analysis.get("key_points") or []
        if key_points:
            lines.append("PUNTOS CLAVE")
            lines.append("-" * 25)
            for kp in key_points:
                lines.append(f"• [{kp.get('timestamp', '00:00')}] {kp.get('text', '')}")
            lines.append("")
            lines.append("-" * 68)
            lines.append("")

    lines.append("TEXTO TRANSCRITO")
    lines.append("-" * 25)

    segments = item.get("segments") or []
    if include_timestamps:
        for seg in segments:
            ts = format_mmss(seg.get("start", 0.0))
            txt = seg.get("text", "").strip()
            if txt:
                lines.append(f"[{ts}] {txt}")
    else:
        paragraphs = analysis.get("paragraphs") or []
        if paragraphs:
            for p in paragraphs:
                lines.append(p.get("text", "").strip())
                lines.append("")
        else:
            lines.append(" ".join(s.get("text", "").strip() for s in segments if s.get("text", "").strip()))

    return "\n".join(lines)


def export_to_srt(item: Dict[str, Any]) -> str:
    segments = item.get("segments") or []
    blocks: List[str] = []
    idx = 1
    for seg in segments:
        txt = seg.get("text", "").strip()
        if not txt:
            continue
        start_ts = format_srt_timestamp(seg.get("start", 0.0))
        end_ts = format_srt_timestamp(seg.get("end", seg.get("start", 0.0) + 2.0))
        blocks.append(f"{idx}\n{start_ts} --> {end_ts}\n{txt}\n")
        idx += 1
    return "\n".join(blocks)


def export_to_docx(item: Dict[str, Any], include_timestamps: bool = True) -> bytes:
    doc = Document()

    # Configurar márgenes
    for section in doc.sections:
        section.top_margin = Inches(0.9)
        section.bottom_margin = Inches(0.9)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)

    title = item.get("title") or item.get("filename") or "Transcripción de Audio/Video"
    heading = doc.add_heading(title, level=0)
    heading.alignment = WD_ALIGN_PARAGRAPH.LEFT

    analysis = item.get("analysis") or {}
    stats = analysis.get("stats") or {}

    meta_p = doc.add_paragraph()
    meta_run = meta_p.add_run(
        f"Idioma: {item.get('language_name', item.get('language', 'Auto'))}   |   "
        f"Duración: {stats.get('duration_formatted', '00:00')}   |   "
        f"Palabras: {stats.get('word_count', 0)}   |   "
        f"Lectura: ~{stats.get('reading_time_minutes', 1)} min"
    )
    meta_run.font.size = Pt(9.5)
    meta_run.font.color.rgb = RGBColor(100, 116, 139)

    summary = analysis.get("executive_summary", "")
    if summary:
        doc.add_heading("Resumen Ejecutivo", level=1)
        p_sum = doc.add_paragraph(summary)
        p_sum.paragraph_format.space_after = Pt(10)

    key_points = analysis.get("key_points") or []
    if key_points:
        doc.add_heading("Puntos Clave", level=1)
        for kp in key_points:
            p_kp = doc.add_paragraph(style="List Bullet")
            r_ts = p_kp.add_run(f"[{kp.get('timestamp', '00:00')}] ")
            r_ts.bold = True
            r_ts.font.color.rgb = RGBColor(37, 99, 235)
            p_kp.add_run(kp.get("text", ""))

    doc.add_heading("Transcripción Completa", level=1)
    segments = item.get("segments") or []

    if include_timestamps:
        for seg in segments:
            txt = seg.get("text", "").strip()
            if not txt:
                continue
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(4)
            r_ts = p.add_run(f"[{format_mmss(seg.get('start', 0.0))}] ")
            r_ts.bold = True
            r_ts.font.size = Pt(9.5)
            r_ts.font.color.rgb = RGBColor(79, 70, 229)
            r_txt = p.add_run(txt)
            r_txt.font.size = Pt(11)
    else:
        paragraphs = analysis.get("paragraphs") or []
        for para in paragraphs:
            p = doc.add_paragraph(para.get("text", ""))
            p.paragraph_format.space_after = Pt(8)
            p.paragraph_format.line_spacing = 1.25

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.read()


def _sanitize_latin1(text: str) -> str:
    replacements = {
        "“": '"', "”": '"', "‘": "'", "’": "'", "–": "-", "—": "-",
        "…": "...", "•": "-", "\u200b": "",
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text.encode("latin-1", errors="replace").decode("latin-1")


def export_to_pdf(item: Dict[str, Any], include_timestamps: bool = True) -> bytes:
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)

    # Intentar cargar fuente TrueType de Windows para soporte completo UTF-8
    font_family = "Helvetica"
    has_unicode_font = False
    win_fonts_dir = os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts")
    regular_font = os.path.join(win_fonts_dir, "arial.ttf")
    bold_font = os.path.join(win_fonts_dir, "arialbd.ttf")

    if os.path.exists(regular_font) and os.path.exists(bold_font):
        try:
            pdf.add_font("ArialWin", "", regular_font)
            pdf.add_font("ArialWin", "B", bold_font)
            font_family = "ArialWin"
            has_unicode_font = True
        except Exception:
            has_unicode_font = False

    def clean(txt: str) -> str:
        return txt if has_unicode_font else _sanitize_latin1(txt)

    pdf.add_page()

    title = item.get("title") or item.get("filename") or "Transcripción de Audio/Video"
    pdf.set_font(font_family, "B", 16)
    pdf.set_text_color(15, 23, 42)
    pdf.multi_cell(0, 9, clean(title))
    pdf.ln(2)

    analysis = item.get("analysis") or {}
    stats = analysis.get("stats") or {}

    meta_text = (
        f"Idioma: {item.get('language_name', item.get('language', 'Auto'))}  |  "
        f"Duración: {stats.get('duration_formatted', '00:00')}  |  "
        f"Palabras: {stats.get('word_count', 0)}  |  "
        f"Lectura: ~{stats.get('reading_time_minutes', 1)} min"
    )
    pdf.set_font(font_family, "", 9.5)
    pdf.set_text_color(100, 116, 139)
    pdf.multi_cell(0, 6, clean(meta_text))
    pdf.ln(3)

    # Línea separadora
    pdf.set_draw_color(226, 232, 240)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(5)

    summary = analysis.get("executive_summary", "")
    if summary:
        pdf.set_font(font_family, "B", 12.5)
        pdf.set_text_color(30, 41, 59)
        pdf.cell(0, 8, clean("Resumen Ejecutivo"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(font_family, "", 10.5)
        pdf.set_text_color(51, 65, 85)
        pdf.multi_cell(0, 6, clean(summary))
        pdf.ln(4)

    key_points = analysis.get("key_points") or []
    if key_points:
        pdf.set_font(font_family, "B", 12.5)
        pdf.set_text_color(30, 41, 59)
        pdf.cell(0, 8, clean("Puntos Clave"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(font_family, "", 10)
        for kp in key_points:
            bullet_line = f"- [{kp.get('timestamp', '00:00')}] {kp.get('text', '')}"
            pdf.set_text_color(51, 65, 85)
            pdf.multi_cell(0, 5.8, clean(bullet_line))
            pdf.ln(1)
        pdf.ln(3)

    pdf.set_font(font_family, "B", 12.5)
    pdf.set_text_color(30, 41, 59)
    pdf.cell(0, 8, clean("Transcripción Completa"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)

    segments = item.get("segments") or []
    if include_timestamps:
        for seg in segments:
            txt = seg.get("text", "").strip()
            if not txt:
                continue
            ts = format_mmss(seg.get("start", 0.0))
            pdf.set_font(font_family, "B", 9.5)
            pdf.set_text_color(79, 70, 229)
            pdf.write(6, clean(f"[{ts}] "))
            pdf.set_font(font_family, "", 10.5)
            pdf.set_text_color(15, 23, 42)
            pdf.write(6, clean(txt + "\n"))
            pdf.ln(1.5)
    else:
        paragraphs = analysis.get("paragraphs") or []
        pdf.set_font(font_family, "", 10.5)
        pdf.set_text_color(15, 23, 42)
        for para in paragraphs:
            pdf.multi_cell(0, 6.2, clean(para.get("text", "")))
            pdf.ln(3)

    return bytes(pdf.output())
