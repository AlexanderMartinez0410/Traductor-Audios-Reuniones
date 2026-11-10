(() => {
  // =========================================================================
  // SISTEMA AUDIO ESCRITO — MOTOR KALDI EN WEBASSEMBLY (SIN IA, EN SILENCIO)
  // Decodifica audio en memoria con OfflineAudioContext y procesa con Vosk Wasm
  // =========================================================================

  let currentFile = null;
  let currentItem = null;
  let historyItems = [];
  let readerFontSize = 1.05;
  let segmentsModified = false;
  let loadedVoskModel = null;

  // Modelo alojado en el mismo dominio de GitHub Pages (CORS 100% libre)
  // Se resuelve a URL absoluta: Vosk carga el modelo dentro de un Web Worker (blob:),
  // donde las rutas relativas pierden el subdirectorio del repo (/Traductor-Audios-Reuniones/).
  // El modelo (~40 MB) vive fuera de docs/ para no exceder el tiempo límite del deploy de
  // GitHub Pages; se sirve desde raw.githubusercontent.com (CORS: *), accesible desde el Worker.
  // IMPORTANTE: vosk-browser solo acepta modelos empaquetados como .tar.gz (no .zip).
  const VOSK_ES_MODEL_URL = "https://raw.githubusercontent.com/AlexanderMartinez0410/Traductor-Audios-Reuniones/master/models/vosk-model-small-es-0.42.tar.gz";
  const VOSK_MODEL_LOAD_TIMEOUT_MS = 180000;
  const VOSK_CHUNK_TIMEOUT_MS = 30000;

  const STOPWORDS = new Set([
    "el","la","los","las","un","una","unos","unas","lo","al","del","de","en","por","para","con","sin",
    "sobre","entre","hacia","hasta","desde","durante","según","contra","ante","bajo","tras","y","e",
    "o","u","ni","que","pero","mas","sino","aunque","como","cuando","donde","quien","cual","cuyo",
    "porque","pues","si","no","ya","muy","más","menos","tan","tanto","todo","toda","todos","todas",
    "otro","otra","otros","otras","mismo","misma","este","esta","estos","estas","ese","esa","esos","esas",
    "mi","mis","tu","tus","su","sus","nuestro","nuestra","yo","tú","él","ella","nosotros","ellos","ellas",
    "me","te","se","nos","le","les","ser","es","son","era","fue","fueron","sea","estar","está","están",
    "estaba","haber","hay","he","ha","hemos","han","había","tener","tiene","tienen","hacer","hace","hizo",
    "ir","va","vamos","van","poder","puede","pueden","decir","dice","dijo","ver","ve","dar","da",
    "también","así","bien","mal","aquí","ahí","allí","ahora","antes","después","luego","entonces","siempre",
    "nunca","bueno","buena","gran","mucho","mucha","eh","ah","mm","verdad","claro"
  ]);

  // DOM
  const uploadView = document.getElementById("uploadView");
  const readerView = document.getElementById("readerView");
  const btnNewTranscription = document.getElementById("btnNewTranscription");
  const historyListEl = document.getElementById("historyList");
  const historySearchInput = document.getElementById("historySearchInput");

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const selectedFileBar = document.getElementById("selectedFileBar");
  const selectedFileName = document.getElementById("selectedFileName");
  const selectedFileSize = document.getElementById("selectedFileSize");
  const btnClearFile = document.getElementById("btnClearFile");

  const btnStartTranscribe = document.getElementById("btnStartTranscribe");

  const progressCard = document.getElementById("progressCard");
  const progressStatusTitle = document.getElementById("progressStatusTitle");
  const progressPct = document.getElementById("progressPct");
  const progressBarFill = document.getElementById("progressBarFill");
  const progressMessage = document.getElementById("progressMessage");

  // DOM Lector
  const docTitle = document.getElementById("docTitle");
  const metaLanguage = document.getElementById("metaLanguage");
  const metaDuration = document.getElementById("metaDuration");
  const metaWords = document.getElementById("metaWords");
  const metaReadingTime = document.getElementById("metaReadingTime");

  const chkExportTimestamps = document.getElementById("chkExportTimestamps");
  const btnExportTxt = document.getElementById("btnExportTxt");
  const btnExportSrt = document.getElementById("btnExportSrt");
  const btnExportDoc = document.getElementById("btnExportDoc");
  const btnExportPdf = document.getElementById("btnExportPdf");

  const transcriptSearchInput = document.getElementById("transcriptSearchInput");
  const searchCountBadge = document.getElementById("searchCountBadge");
  const btnFontDec = document.getElementById("btnFontDec");
  const btnFontInc = document.getElementById("btnFontInc");
  const btnCopyAll = document.getElementById("btnCopyAll");

  const paragraphsContainer = document.getElementById("paragraphsContainer");
  const segmentsContainer = document.getElementById("segmentsContainer");
  const btnSaveSegmentEdits = document.getElementById("btnSaveSegmentEdits");

  const summaryText = document.getElementById("summaryText");
  const btnCopySummary = document.getElementById("btnCopySummary");
  const keyPointsList = document.getElementById("keyPointsList");
  const keywordsCloud = document.getElementById("keywordsCloud");
  const questionsBlock = document.getElementById("questionsBlock");
  const questionsList = document.getElementById("questionsList");

  const btnThemeToggle = document.getElementById("btnThemeToggle");
  const themeLabel = document.getElementById("themeLabel");
  const toastEl = document.getElementById("toast");

  function showToast(msg, duration = 3000) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.add("hidden"), duration);
  }

  function formatTimestamp(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 KB";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function highlightQuery(text, query) {
    const safe = escapeHtml(text);
    if (!query || !query.trim()) return safe;
    const escapedQ = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return safe.replace(new RegExp(`(${escapedQ})`, "gi"), '<mark class="search-hit">$1</mark>');
  }

  // TEMA CLARO / OSCURO
  function initTheme() {
    const saved = localStorage.getItem("audio_escrito_theme") || "dark";
    setTheme(saved);
  }
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("audio_escrito_theme", t);
    if (themeLabel) themeLabel.textContent = t === "light" ? "Oscuro" : "Claro";
  }
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      setTheme(cur === "dark" ? "light" : "dark");
    });
  }

  // HISTORIAL LOCAL
  function loadLocalHistory() {
    try {
      historyItems = JSON.parse(localStorage.getItem("audio_escrito_history") || "[]");
    } catch (_) {
      historyItems = [];
    }
    renderHistoryList();
  }

  function saveLocalHistory() {
    try {
      localStorage.setItem("audio_escrito_history", JSON.stringify(historyItems));
    } catch (_) {}
    renderHistoryList();
  }

  function renderHistoryList() {
    if (!historyListEl) return;
    const q = (historySearchInput ? historySearchInput.value : "").trim().toLowerCase();
    const filtered = historyItems.filter(item => {
      if (!q) return true;
      return (item.title || "").toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
      historyListEl.innerHTML = `<div class="empty-history">Sin transcripciones aún.</div>`;
      return;
    }

    historyListEl.innerHTML = filtered.map(item => {
      const isActive = currentItem && currentItem.id === item.id;
      return `
        <div class="history-item ${isActive ? "active" : ""}" data-id="${item.id}">
          <div class="history-item-main">
            <div class="history-item-title">${escapeHtml(item.title)}</div>
            <div class="history-item-meta">
              <span>${escapeHtml(item.duration_formatted || "00:00")}</span>
              <span>•</span>
              <span>${item.word_count || 0} pal.</span>
            </div>
          </div>
          <button class="history-delete-btn" data-delete-id="${item.id}">Eliminar</button>
        </div>
      `;
    }).join("");

    historyListEl.querySelectorAll(".history-item").forEach(el => {
      el.addEventListener("click", e => {
        if (e.target.closest(".history-delete-btn")) return;
        const id = el.getAttribute("data-id");
        const found = historyItems.find(x => x.id === id);
        if (found) openItem(found);
      });
    });

    historyListEl.querySelectorAll(".history-delete-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const id = btn.getAttribute("data-delete-id");
        if (!confirm("¿Eliminar transcripción?")) return;
        historyItems = historyItems.filter(x => x.id !== id);
        saveLocalHistory();
        if (currentItem && currentItem.id === id) showUploadView();
      });
    });
  }

  if (historySearchInput) historySearchInput.addEventListener("input", renderHistoryList);

  function showUploadView() {
    currentItem = null;
    readerView.classList.add("hidden");
    uploadView.classList.remove("hidden");
    renderHistoryList();
  }
  if (btnNewTranscription) btnNewTranscription.addEventListener("click", showUploadView);

  // MANEJO DE ARCHIVOS
  function handleFileSelected(file) {
    if (!file) return;
    currentFile = file;
    if (selectedFileName) selectedFileName.textContent = file.name;
    if (selectedFileSize) selectedFileSize.textContent = formatBytes(file.size);

    dropzone.classList.add("hidden");
    selectedFileBar.classList.remove("hidden");
    btnStartTranscribe.disabled = false;
  }

  function clearSelectedFile() {
    currentFile = null;
    if (fileInput) fileInput.value = "";
    selectedFileBar.classList.add("hidden");
    dropzone.classList.remove("hidden");
    btnStartTranscribe.disabled = true;
  }

  if (dropzone) dropzone.addEventListener("click", () => fileInput && fileInput.click());
  if (fileInput) fileInput.addEventListener("change", e => {
    if (e.target.files && e.target.files[0]) handleFileSelected(e.target.files[0]);
  });
  if (dropzone) {
    dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("dragover"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", e => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileSelected(e.dataTransfer.files[0]);
    });
  }
  if (btnClearFile) btnClearFile.addEventListener("click", clearSelectedFile);

  // ANÁLISIS DE TEXTO Y RESUMEN (TF-IDF ALGORÍTMICO)
  function analyzeTranscriptText(segments, duration = 0) {
    const fullText = segments.map(s => s.text.trim()).join(" ");
    const words = fullText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    const cleanTokens = fullText.toLowerCase().match(/[a-záéíóúüñ]{3,}/g) || [];
    const freqMap = {};
    cleanTokens.forEach(w => {
      if (!STOPWORDS.has(w)) freqMap[w] = (freqMap[w] || 0) + 1;
    });

    const keywords = Object.entries(freqMap)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word: word.charAt(0).toUpperCase() + word.slice(1), count }));

    const paragraphs = [];
    let curPara = [];
    let pStart = segments[0] ? segments[0].start : 0;
    let pEnd = pStart;
    let pWords = 0;

    segments.forEach(seg => {
      if (!seg.text.trim()) return;
      if (curPara.length === 0) pStart = seg.start;
      curPara.push(seg.text.trim());
      pEnd = seg.end;
      pWords += seg.text.trim().split(/\s+/).length;

      const endsSentence = /[.!?…]$/.test(seg.text.trim());
      if ((pWords >= 50 && endsSentence) || pWords >= 85) {
        paragraphs.push({
          start: pStart,
          end: pEnd,
          timestamp: formatTimestamp(pStart),
          text: curPara.join(" ")
        });
        curPara = [];
        pWords = 0;
      }
    });
    if (curPara.length > 0) {
      paragraphs.push({
        start: pStart,
        end: pEnd,
        timestamp: formatTimestamp(pStart),
        text: curPara.join(" ")
      });
    }

    const maxFreq = Math.max(1, ...Object.values(freqMap));
    const scoredSegments = segments.map((seg, idx) => {
      const segTokens = (seg.text.toLowerCase().match(/[a-záéíóúüñ]{3,}/g) || []).filter(w => !STOPWORDS.has(w));
      let score = 0;
      segTokens.forEach(t => { score += (freqMap[t] || 0) / maxFreq; });
      if (seg.text.length < 15) score = 0.1;
      return { ...seg, score, idx };
    });

    const sortedByScore = [...scoredSegments].sort((a,b) => b.score - a.score);
    const topForSummary = sortedByScore.slice(0, Math.min(4, Math.max(1, Math.floor(segments.length / 4)))).sort((a,b) => a.idx - b.idx);
    const executiveSummary = topForSummary.map(s => s.text).join(" ") || fullText.slice(0, 300);

    const keyPoints = sortedByScore.slice(0, Math.min(6, segments.length)).sort((a,b) => a.idx - b.idx).map(s => ({
      timestamp: formatTimestamp(s.start),
      start: s.start,
      text: s.text
    }));

    const questions = segments.filter(s => s.text.includes("?") || /^(cómo|cuándo|dónde|por qué|qué|quién)\b/i.test(s.text.trim())).map(s => ({
      timestamp: formatTimestamp(s.start),
      start: s.start,
      text: s.text
    }));

    return {
      stats: {
        word_count: wordCount,
        duration_formatted: formatTimestamp(duration),
        reading_time_minutes: Math.max(1, Math.ceil(wordCount / 200))
      },
      executive_summary: executiveSummary,
      key_points: keyPoints,
      keywords,
      questions,
      paragraphs
    };
  }

  // =========================================================================
  // DECODIFICACIÓN Y PROCESAMIENTO EN MEMORIA (SILENCIOSO CON AUDIO OFFLINE)
  // =========================================================================
  async function decodeAudioSilentlyToPCM16(file, onProgress) {
    onProgress("Leyendo archivo en memoria...", 15);
    const arrayBuffer = await file.arrayBuffer();

    onProgress("Decodificando ondas acústicas (DSP)...", 30);
    // Usamos OfflineAudioContext para NO reproducir sonido por los altavoces
    const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    tempCtx.close();

    const sampleRate = 16000;
    const duration = audioBuffer.duration;
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    onProgress("Remuestreando a 16kHz mono para Kaldi...", 45);
    const resampledBuffer = await offlineCtx.startRendering();
    const channelData = resampledBuffer.getChannelData(0);

    // vosk-browser recibe Float32 [-1, 1] y hace la conversión a rango int16 internamente
    return { pcmData: channelData, duration, sampleRate };
  }

  // Rechaza la promesa si no se resuelve en el tiempo indicado (evita cuelgues infinitos)
  function withTimeout(promise, ms, message) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      })
    ]).finally(() => clearTimeout(timer));
  }

  // =========================================================================
  // TRANSCRIPCIÓN CON KALDI / VOSK WEBASSEMBLY (CLIENT-SIDE Y SILENCIOSO)
  // =========================================================================
  if (btnStartTranscribe) {
    btnStartTranscribe.addEventListener("click", async () => {
      if (!currentFile) return;

      btnStartTranscribe.disabled = true;
      progressCard.classList.remove("hidden");
      progressPct.textContent = "10%";
      progressBarFill.style.width = "10%";
      progressStatusTitle.textContent = "Iniciando motor algorítmico Kaldi...";
      progressMessage.textContent = "Preparando WebAssembly en memoria...";

      try {
        const { pcmData, duration, sampleRate } = await decodeAudioSilentlyToPCM16(
          currentFile,
          (msg, pct) => {
            progressStatusTitle.textContent = msg;
            progressPct.textContent = `${pct}%`;
            progressBarFill.style.width = `${pct}%`;
          }
        );

        progressStatusTitle.textContent = "Cargando diccionario fonético Kaldi Wasm...";
        progressPct.textContent = "55%";
        progressBarFill.style.width = "55%";
        progressMessage.textContent = "Si es la primera vez, se descarga el modelo en español (~40 MB)...";

        // Cargar Vosk Wasm
        if (!loadedVoskModel && window.Vosk) {
          try {
            loadedVoskModel = await withTimeout(
              Vosk.createModel(VOSK_ES_MODEL_URL),
              VOSK_MODEL_LOAD_TIMEOUT_MS,
              "Tiempo de espera agotado cargando el modelo Vosk."
            );
          } catch (modelErr) {
            console.warn("Error cargando modelo remoto de Vosk:", modelErr);
          }
        }

        const segments = [];
        let segId = 1;

        if (loadedVoskModel) {
          progressStatusTitle.textContent = "Decodificando fonemas con Kaldi en WebAssembly...";
          const recognizer = new loadedVoskModel.KaldiRecognizer(sampleRate);
          recognizer.setWords(true);

          // vosk-browser es asíncrono (Web Worker): cada bloque enviado responde con
          // exactamente un evento "result" o "partialresult". Enviamos un bloque y
          // esperamos su respuesta para tener progreso real y no saturar memoria.
          let pendingResolve = null;
          const pushResult = (result, fallbackStart, fallbackEnd) => {
            const text = result && result.text ? result.text.trim() : "";
            if (!text) return;
            const words = Array.isArray(result.result) ? result.result : [];
            const startSec = Math.round((words.length ? words[0].start : fallbackStart) * 10) / 10;
            const endSec = Math.round((words.length ? words[words.length - 1].end : fallbackEnd) * 10) / 10;
            segments.push({
              id: segId++,
              start: startSec,
              end: endSec,
              timestamp: formatTimestamp(startSec),
              text: text.charAt(0).toUpperCase() + text.slice(1) + "."
            });
          };
          let lastSegmentEnd = 0;
          let currentChunkEnd = 0;
          recognizer.on("result", (message) => {
            pushResult(message.result, lastSegmentEnd, Math.min(duration, currentChunkEnd));
            lastSegmentEnd = Math.min(duration, currentChunkEnd);
            if (pendingResolve) pendingResolve();
          });
          recognizer.on("partialresult", () => {
            if (pendingResolve) pendingResolve();
          });
          const waitForWorker = () => withTimeout(
            new Promise((resolve) => { pendingResolve = resolve; }),
            VOSK_CHUNK_TIMEOUT_MS,
            "El motor Kaldi dejó de responder durante la transcripción."
          ).finally(() => { pendingResolve = null; });

          const chunkSize = sampleRate * 2; // Bloques de 2 segundos
          for (let i = 0; i < pcmData.length; i += chunkSize) {
            currentChunkEnd = (i + chunkSize) / sampleRate;
            const ack = waitForWorker();
            recognizer.acceptWaveformFloat(pcmData.subarray(i, i + chunkSize), sampleRate);
            await ack;
            const curPct = Math.min(95, 55 + Math.round((i / pcmData.length) * 40));
            progressPct.textContent = `${curPct}%`;
            progressBarFill.style.width = `${curPct}%`;
            progressMessage.textContent = `Procesando muestras [${formatTimestamp(i / sampleRate)} / ${formatTimestamp(duration)}]...`;
          }

          currentChunkEnd = duration;
          const finalAck = waitForWorker();
          recognizer.retrieveFinalResult();
          await finalAck;
          recognizer.remove();
        } else {
          // Fallback informativo si el navegador bloquea la descarga del zip de Vosk por CORS
          throw new Error("No se pudo cargar el diccionario de Vosk en el navegador. Recuerda que puedes descargar el archivo 'iniciar.bat' desde la barra lateral izquierda para ejecutar Kaldi en tu PC sin límites.");
        }

        progressPct.textContent = "100%";
        progressBarFill.style.width = "100%";
        progressStatusTitle.textContent = "Transcripción completada.";
        progressMessage.textContent = "Generando resumen algorítmico y modo lectura...";

        const fileTitle = currentFile.name.replace(/\.[^/.]+$/, "");
        setTimeout(() => {
          progressCard.classList.add("hidden");
          btnStartTranscribe.disabled = false;
          clearSelectedFile();

          const analysis = analyzeTranscriptText(segments, duration);
          const newItem = {
            id: "trans_" + Date.now(),
            title: fileTitle,
            duration: duration,
            duration_formatted: formatTimestamp(duration),
            word_count: analysis.stats.word_count,
            language_name: "Español",
            segments,
            analysis
          };

          historyItems.unshift(newItem);
          saveLocalHistory();
          openItem(newItem);
          showToast("Transcripción lista.");
        }, 500);

      } catch (err) {
        showToast(err.message, 6000);
        btnStartTranscribe.disabled = false;
        progressCard.classList.add("hidden");
      }
    });
  }

  // =========================================================================
  // VISTA LECTOR
  // =========================================================================
  function openItem(item) {
    currentItem = item;
    segmentsModified = false;
    if (btnSaveSegmentEdits) btnSaveSegmentEdits.classList.add("hidden");

    uploadView.classList.add("hidden");
    readerView.classList.remove("hidden");

    const stats = (item.analysis && item.analysis.stats) || {};
    docTitle.textContent = item.title || "Reunión";
    metaLanguage.textContent = item.language_name || "Español";
    metaDuration.textContent = stats.duration_formatted || item.duration_formatted || "00:00";
    metaWords.textContent = `${stats.word_count || 0} palabras`;
    if (metaReadingTime) metaReadingTime.textContent = `~${stats.reading_time_minutes || 1} min`;

    renderReaderContent();
    renderHistoryList();
  }

  function renderReaderContent() {
    if (!currentItem) return;
    const query = (transcriptSearchInput ? transcriptSearchInput.value : "").trim();
    const analysis = currentItem.analysis || {};
    const paragraphs = analysis.paragraphs || [];
    const segments = currentItem.segments || [];

    if (query) {
      const fullText = segments.map(s => s.text).join(" ");
      const matches = fullText.match(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"));
      searchCountBadge.textContent = matches ? matches.length : 0;
      searchCountBadge.classList.remove("hidden");
    } else {
      searchCountBadge.classList.add("hidden");
    }

    // 1. Párrafos
    if (paragraphs.length === 0) {
      paragraphsContainer.innerHTML = `<p style="color:var(--text-muted)">Sin texto de voz detectado.</p>`;
    } else {
      paragraphsContainer.innerHTML = paragraphs.map(p => `
        <div class="reader-paragraph">
          <span class="para-ts">${p.timestamp}</span>
          <span class="para-text">${highlightQuery(p.text, query)}</span>
        </div>
      `).join("");
    }

    // 2. Segmentos
    segmentsContainer.innerHTML = segments.map((seg, idx) => `
      <div class="segment-row">
        <span class="segment-time-btn">${seg.timestamp}</span>
        <div class="segment-text" contenteditable="true" spellcheck="false" data-idx="${idx}">${highlightQuery(seg.text, query)}</div>
      </div>
    `).join("");

    segmentsContainer.querySelectorAll(".segment-text").forEach(el => {
      el.addEventListener("input", () => {
        const i = parseInt(el.getAttribute("data-idx"));
        if (currentItem && currentItem.segments[i]) {
          currentItem.segments[i].text = el.innerText.trim();
          segmentsModified = true;
          if (btnSaveSegmentEdits) btnSaveSegmentEdits.classList.remove("hidden");
        }
      });
    });

    // 3. Resumen y Puntos Clave
    summaryText.innerHTML = highlightQuery(analysis.executive_summary || "Sin resumen disponible.", query);

    keyPointsList.innerHTML = (analysis.key_points || []).map(kp => `
      <li>
        <span class="segment-time-btn">${kp.timestamp}</span>
        <span>${highlightQuery(kp.text, query)}</span>
      </li>
    `).join("");

    keywordsCloud.innerHTML = (analysis.keywords || []).map(kw => `
      <span class="keyword-chip">${escapeHtml(kw.word)} <small>×${kw.count}</small></span>
    `).join("");

    if (analysis.questions && analysis.questions.length > 0) {
      questionsBlock.classList.remove("hidden");
      questionsList.innerHTML = analysis.questions.map(q => `
        <li>
          <span class="segment-time-btn">${q.timestamp}</span>
          <span>${escapeHtml(q.text)}</span>
        </li>
      `).join("");
    } else {
      questionsBlock.classList.add("hidden");
    }
  }

  // Pestañas
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-tab");
      document.getElementById("tabParagraphs").classList.toggle("hidden", target !== "paragraphs");
      document.getElementById("tabSegments").classList.toggle("hidden", target !== "segments");
      document.getElementById("tabSummary").classList.toggle("hidden", target !== "summary");
    });
  });

  if (transcriptSearchInput) transcriptSearchInput.addEventListener("input", renderReaderContent);

  if (btnFontDec) btnFontDec.addEventListener("click", () => {
    readerFontSize = Math.max(0.85, readerFontSize - 0.08);
    document.documentElement.style.setProperty("--reader-font-size", `${readerFontSize}rem`);
  });
  if (btnFontInc) btnFontInc.addEventListener("click", () => {
    readerFontSize = Math.min(1.5, readerFontSize + 0.08);
    document.documentElement.style.setProperty("--reader-font-size", `${readerFontSize}rem`);
  });

  if (docTitle) {
    docTitle.addEventListener("blur", () => {
      if (!currentItem) return;
      currentItem.title = docTitle.textContent.trim() || currentItem.title;
      saveLocalHistory();
    });
  }

  if (btnSaveSegmentEdits) {
    btnSaveSegmentEdits.addEventListener("click", () => {
      if (!currentItem) return;
      currentItem.analysis = analyzeTranscriptText(currentItem.segments, currentItem.duration);
      saveLocalHistory();
      segmentsModified = false;
      btnSaveSegmentEdits.classList.add("hidden");
      renderReaderContent();
      showToast("Guardado.");
    });
  }

  if (btnCopyAll) {
    btnCopyAll.addEventListener("click", async () => {
      if (!currentItem) return;
      const txt = currentItem.segments.map(s => `[${s.timestamp}] ${s.text}`).join("\n");
      await navigator.clipboard.writeText(txt);
      showToast("Copiado.");
    });
  }

  if (btnCopySummary) {
    btnCopySummary.addEventListener("click", async () => {
      if (!currentItem || !currentItem.analysis) return;
      await navigator.clipboard.writeText(currentItem.analysis.executive_summary || "");
      showToast("Resumen copiado.");
    });
  }

  // Exportaciones
  function downloadBlob(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (btnExportTxt) {
    btnExportTxt.addEventListener("click", () => {
      if (!currentItem) return;
      const incTs = chkExportTimestamps ? chkExportTimestamps.checked : true;
      const lines = [
        `TRANSCRIPCIÓN: ${currentItem.title}`,
        `Duración: ${currentItem.duration_formatted}`,
        "=".repeat(60),
        ""
      ];
      if (currentItem.analysis.executive_summary) {
        lines.push("RESUMEN EJECUTIVO:", currentItem.analysis.executive_summary, "", "-".repeat(60), "");
      }
      lines.push("TEXTO TRANSCRITO:");
      currentItem.segments.forEach(s => {
        lines.push(incTs ? `[${s.timestamp}] ${s.text}` : s.text);
      });
      downloadBlob(lines.join("\n"), `${currentItem.title}.txt`, "text/plain;charset=utf-8");
    });
  }

  if (btnExportSrt) {
    btnExportSrt.addEventListener("click", () => {
      if (!currentItem) return;
      const srtBlocks = currentItem.segments.map((s, idx) => {
        const toSrtTime = sec => {
          const sInt = Math.floor(sec);
          const ms = Math.round((sec - sInt) * 1000);
          const h = Math.floor(sInt / 3600);
          const m = Math.floor((sInt % 3600) / 60);
          const sc = sInt % 60;
          return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sc).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
        };
        return `${idx + 1}\n${toSrtTime(s.start)} --> ${toSrtTime(s.end)}\n${s.text}\n`;
      });
      downloadBlob(srtBlocks.join("\n"), `${currentItem.title}.srt`, "text/plain;charset=utf-8");
    });
  }

  if (btnExportDoc) {
    btnExportDoc.addEventListener("click", () => {
      if (!currentItem) return;
      const incTs = chkExportTimestamps ? chkExportTimestamps.checked : true;
      const html = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>${currentItem.title}</title></head>
        <body>
          <h2>${currentItem.title}</h2>
          <p><em>Duración: ${currentItem.duration_formatted} | Palabras: ${currentItem.word_count}</em></p>
          <hr/>
          <h3>Resumen Ejecutivo</h3>
          <p>${currentItem.analysis.executive_summary || ""}</p>
          <h3>Transcripción</h3>
          ${currentItem.segments.map(s => `<p>${incTs ? `<b>[${s.timestamp}]</b> ` : ""}${s.text}</p>`).join("")}
        </body></html>
      `;
      downloadBlob(html, `${currentItem.title}.doc`, "application/msword;charset=utf-8");
    });
  }

  if (btnExportPdf) {
    btnExportPdf.addEventListener("click", () => {
      if (!currentItem) return;
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) { window.print(); return; }

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      let y = 45;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(currentItem.title, 40, y);
      y += 22;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Duración: ${currentItem.duration_formatted} | Palabras: ${currentItem.word_count}`, 40, y);
      y += 24;

      if (currentItem.analysis.executive_summary) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(20);
        doc.text("Resumen Ejecutivo:", 40, y);
        y += 16;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        const sumLines = doc.splitTextToSize(currentItem.analysis.executive_summary, pageWidth - 80);
        doc.text(sumLines, 40, y);
        y += sumLines.length * 14 + 16;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Transcripción:", 40, y);
      y += 18;

      const incTs = chkExportTimestamps ? chkExportTimestamps.checked : true;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(30);

      currentItem.segments.forEach(s => {
        const lineText = incTs ? `[${s.timestamp}] ${s.text}` : s.text;
        const wrapped = doc.splitTextToSize(lineText, pageWidth - 80);
        if (y + wrapped.length * 14 > doc.internal.pageSize.getHeight() - 40) {
          doc.addPage();
          y = 45;
        }
        doc.text(wrapped, 40, y);
        y += wrapped.length * 14 + 4;
      });

      doc.save(`${currentItem.title}.pdf`);
    });
  }

  initTheme();
  loadLocalHistory();
})();
