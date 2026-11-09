# 🎙️ Sistema Audio Escrito — Transcriptor y Lector Local IA

Aplicación web local y gratuita para convertir archivos de **audio** (`.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, `.aac`, `.opus`) y **video** (`.mp4`, `.mkv`, `.webm`, `.mov`, `.avi`) en **texto estructurado para leer**, con reproductor sincronizado, resumen automático y exportación a múltiples formatos.

---

## ✨ Características Principales

- 🔒 **100% Local y Gratuito**: Basado en `Faster-Whisper` (CTranslate2 + PyAV integrado, no requiere instalar FFmpeg aparte ni pagar claves API).
- 📖 **Modo Lectura Continua + Vista con Marcas de Tiempo**:
  - **Lectura Continua**: Agrupa las frases en párrafos naturales estilo artículo/libro para leer cómodamente, con ajuste de tamaño de fuente (`A-` / `A+`) y modo Claro/Oscuro.
  - **Sincronización Interactiva**: Haz clic en cualquier párrafo o marca de tiempo (`[MM:SS]`) para que el audio o video salte exactamente a ese segundo. Mientras se reproduce, el párrafo actual se ilumina automáticamente.
- ✨ **Resumen Ejecutivo y Puntos Clave**:
  - Genera automáticamente un resumen ejecutivo, lista de puntos clave con sus marcas de tiempo clicables, desglose por bloques temáticos, preguntas detectadas y nube de palabras frecuentes.
- 🌐 **Detección Automática de Idioma y Traducción**:
  - Detecta el idioma hablado automáticamente y permite traducir la transcripción completa a Español, Inglés, Portugués, Francés, Italiano o Alemán conservando las marcas de tiempo.
- 📥 **Exportación en 1 Clic**:
  - **TXT** (Texto plano con o sin marcas de tiempo)
  - **SRT** (Subtítulos estándar para videos)
  - **Word (`.docx`)** (Documento con diseño editorial, resumen, puntos clave y transcripción)
  - **PDF (`.pdf`)** (Documento listo para imprimir o leer en cualquier dispositivo)
- 🎙️ **Grabadora de Micrófono Integrada**: Permite grabar notas de voz en vivo desde el navegador y transcribirlas al instante.
- 📚 **Biblioteca Persistente**: Guarda todas tus transcripciones localmente en `data/` para consultarlas cuando quieras sin volver a procesarlas.

---

## 🌐 Publicación en GitHub Pages (100% Client-Side, Costo $0)

El proyecto incluye la versión estática lista para alojarse en **GitHub Pages** dentro de la carpeta [`docs/`](file:///C:/Users/DESARROLLADOR-PC02/Desktop/Proyectos%20Desarrollados/Sencillos/Sistema%20Audio%20Escrito/docs):

1. Sube este repositorio a tu cuenta de GitHub (`git add .`, `git commit`, `git push`).
2. En tu repositorio en GitHub, ve a **Settings** > **Pages**.
3. En **Branch**, selecciona tu rama principal (ej. `main` o `master`) y en la carpeta elige **`/docs`**.
4. Haz clic en **Save**. En un minuto tendrás tu enlace público `https://<tu-usuario>.github.io/<tu-repo>/`.

---

## 🚀 Cómo Iniciar el Sistema

### Opción 1: Inicio en 1 clic (Windows)
Haz doble clic en el archivo **`iniciar.bat`**. Se abrirá automáticamente tu navegador en `http://localhost:8000`.

### Opción 2: Desde terminal
```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Luego abre **http://localhost:8000** en tu navegador.
