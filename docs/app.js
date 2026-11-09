(() => {
  // =========================================================================
  // SISTEMA AUDIO ESCRITO — CLIENT-SIDE ENGINE PARA GITHUB PAGES
  // 100% en el navegador (Web Audio API + Speech Recognition nativo)
  // Sin servidores backend, sin peticiones POST a /api (Costo $0)
  // =========================================================================

  let currentFile = null;
  let currentObjectUrl = null;
  let currentItem = null;
  let historyItems = [];
  let isProcessing = false;
  let recognitionInstance = null;
  let segmentsModified = false;
  let readerFontSize = 1.05;

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
    "nunca","bueno","buena","gran","mucho","mucha","eh","ah","mm","verdad","claro","the","be","to","of",
    "and","a","in","that","have","i","it","for","not","on","with","he","as","you","do","at","this","but"
  ]);

  // DOM Upload
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

  const btnLiveSpeech = document.getElementById("btnLiveSpeech");
  const btnStopLiveSpeech = document.getElementById("btnStopLiveSpeech");
  const micDot = document.getElementById("micDot");
  const recorderStatusText = document.getElementById("recorderStatusText");
  const recorderTimer = document.getElementById("recorderTimer");

  const languageSelect = document.getElementById("languageSelect");
  const speedModeSelect = document.getElementById("speedModeSelect");
  const btnStartTranscribe = document.getElementById("btnStartTranscribe");

  const progressCard = document.getElementById("progressCard");
  const progressStatusTitle = document.getElementById("progressStatusTitle");
  const progressPct = document.getElementById("progressPct");
  const progressBarFill = document.getElementById("progressBarFill");
  const progressMessage = document.getElementById("progressMessage");
  const livePreviewBox = document.getElementById("livePreviewBox");
  const livePreviewText = document.getElementById("livePreviewText");
  const btnCancelTranscribe = document.getElementById("btnCancelTranscribe");

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

  const videoWrapper = document.getElementById("videoWrapper");
  const audioWrapper = document.getElementById("audioWrapper");
  const videoPlayer = document.getElementById("videoPlayer");
  const audioPlayer = document.getElementById("audioPlayer");
  const btnRewind5 = document.getElementById("btnRewind5");
  const btnForward5 = document.getElementById("btnForward5");
  const chkAutoScroll = document.getElementById("chkAutoScroll");
  const playbackSpeedSelect = document.getElementById("playbackSpeedSelect");

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

  function getActivePlayer() {
    return (currentItem && currentItem.media_type === "video") ? videoPlayer : audioPlayer;
  }

  function pauseAllPlayers() {
    try { videoPlayer.pause(); audioPlayer.pause(); } catch (_) {}
  }

  function seekToSeconds(sec) {
    const p = getActivePlayer();
    if (p) {
      p.currentTime = Math.max(0, Number(sec) || 0);
      p.play().catch(() => {});
    }
  }

  // TEMA CLARO / OSCURO (VERCEL STYLE)
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

  // HISTORIAL LOCALSTORAGE (100% CLIENT-SIDE)
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
      historyListEl.innerHTML = `<div class="empty-history">Sin transcripciones guardadas en este navegador.</div>`;
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
    pauseAllPlayers();
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
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);

    if (selectedFileName) selectedFileName.textContent = file.name;
    if (selectedFileSize) selectedFileSize.textContent = formatBytes(file.size);

    dropzone.classList.add("hidden");
    selectedFileBar.classList.remove("hidden");
    btnStartTranscribe.disabled = false;
  }

  function clearSelectedFile() {
    currentFile = null;
    if (fileInput) fileInput.value = "";
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
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

  // =========================================================================
  // ALGORITMOS DE TEXTO Y RESUMEN (TF-IDF CLIENT-SIDE)
  // =========================================================================
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
  // TRANSCRIPCIÓN CLIENT-SIDE DIRECTA EN EL NAVEGADOR
  // =========================================================================
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (btnStartTranscribe) {
    btnStartTranscribe.addEventListener("click", async () => {
      if (!currentFile || !currentObjectUrl) return;

      if (!SpeechRecognition) {
        alert("Tu navegador no soporta Speech Recognition nativo. Por favor abre este enlace en Google Chrome, Microsoft Edge, Brave u Opera.");
        return;
      }

      isProcessing = true;
      btnStartTranscribe.disabled = true;
      progressCard.classList.remove("hidden");
      progressPct.textContent = "5%";
      progressBarFill.style.width = "5%";
      progressStatusTitle.textContent = "Analizando audio en el navegador...";
      progressMessage.textContent = "Iniciando reconocimiento fonético...";
      livePreviewBox.classList.add("hidden");

      const isVideo = currentFile.type.startsWith("video/") || /\.(mp4|mkv|webm|mov|avi)$/i.test(currentFile.name);
      const mediaEl = document.createElement(isVideo ? "video" : "audio");
      mediaEl.src = currentObjectUrl;
      const rate = speedModeSelect ? (parseFloat(speedModeSelect.value) || 1.0) : 1.0;
      mediaEl.playbackRate = rate;

      await new Promise(resolve => {
        mediaEl.onloadedmetadata = () => resolve();
        mediaEl.onerror = () => resolve();
        setTimeout(resolve, 3000);
      });

      const totalDuration = mediaEl.duration || 60;
      const segments = [];
      let segId = 1;
      let chunkStartTime = 0;

      const recognizer = new SpeechRecognition();
      recognizer.lang = languageSelect ? languageSelect.value : "es-ES";
      recognizer.continuous = true;
      recognizer.interimResults = true;

      recognizer.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript.trim();
          if (event.results[i].isFinal && transcript) {
            const curTime = mediaEl.currentTime;
            segments.push({
              id: segId++,
              start: Math.round(chunkStartTime * 10) / 10,
              end: Math.round(curTime * 10) / 10,
              timestamp: formatTimestamp(chunkStartTime),
              text: transcript.charAt(0).toUpperCase() + transcript.slice(1) + "."
            });
            chunkStartTime = curTime;

            livePreviewBox.classList.remove("hidden");
            livePreviewText.textContent = `"${transcript}"`;
          }
        }
      };

      recognizer.onerror = (e) => {
        if (e.error !== "no-speech") console.warn("SpeechRec:", e.error);
      };

      const progressTimer = setInterval(() => {
        if (!isProcessing) { clearInterval(progressTimer); return; }
        const cur = mediaEl.currentTime || 0;
        const pct = Math.min(96, Math.round((cur / totalDuration) * 90) + 5);
        progressPct.textContent = `${pct}%`;
        progressBarFill.style.width = `${pct}%`;
        progressMessage.textContent = `Analizando audio [${formatTimestamp(cur)} / ${formatTimestamp(totalDuration)}]...`;
      }, 400);

      const finishTranscription = () => {
        clearInterval(progressTimer);
        try { recognizer.stop(); } catch (_) {}
        try { mediaEl.pause(); } catch (_) {}

        progressPct.textContent = "100%";
        progressBarFill.style.width = "100%";
        progressStatusTitle.textContent = "¡Transcripción completada!";
        progressMessage.textContent = "Generando resumen algorítmico y modo lectura...";

        setTimeout(() => {
          progressCard.classList.add("hidden");
          btnStartTranscribe.disabled = false;
          isProcessing = false;

          const analysis = analyzeTranscriptText(segments, totalDuration);
          const newItem = {
            id: "rec_" + Date.now(),
            title: currentFile.name.replace(/\.[^/.]+$/, ""),
            media_type: isVideo ? "video" : "audio",
            duration: totalDuration,
            duration_formatted: formatTimestamp(totalDuration),
            word_count: analysis.stats.word_count,
            language_name: languageSelect ? languageSelect.options[languageSelect.selectedIndex].text : "Español",
            segments,
            analysis,
            blobUrl: currentObjectUrl
          };

          historyItems.unshift(newItem);
          saveLocalHistory();
          openItem(newItem);
          showToast("Transcripción lista.");
        }, 600);
      };

      mediaEl.onended = finishTranscription;
      if (btnCancelTranscribe) btnCancelTranscribe.onclick = finishTranscription;

      try {
        recognizer.start();
        mediaEl.play().catch(err => {
          alert("Interactúa con la página para permitir el procesamiento de audio: " + err.message);
          finishTranscription();
        });
      } catch (err) {
        alert("Error al iniciar el reconocedor de voz: " + err.message);
        finishTranscription();
      }
    });
  }

  // =========================================================================
  // REUNIÓN EN VIVO DIRECTA (MICRÓFONO)
  // =========================================================================
  if (btnLiveSpeech) {
    btnLiveSpeech.addEventListener("click", () => {
      if (!SpeechRecognition) {
        alert("Tu navegador no soporta Speech Recognition nativo. Usa Chrome o Edge.");
        return;
      }

      const liveSegments = [];
      let liveId = 1;
      let segStart = 0;
      let liveSec = 0;

      recognitionInstance = new SpeechRecognition();
      recognitionInstance.lang = languageSelect ? languageSelect.value : "es-ES";
      recognitionInstance.continuous = true;
      recognitionInstance.interimResults = true;

      recognitionInstance.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            const txt = event.results[i][0].transcript.trim();
            if (txt) {
              liveSegments.push({
                id: liveId++,
                start: segStart,
                end: liveSec,
                timestamp: formatTimestamp(segStart),
                text: txt.charAt(0).toUpperCase() + txt.slice(1) + "."
              });
              segStart = liveSec;
            }
          }
        }
      };

      try {
        recognitionInstance.start();
        micDot.classList.add("recording");
        recorderTimer.textContent = "00:00";
        recorderTimer.classList.remove("hidden");
        btnLiveSpeech.classList.add("hidden");
        btnStopLiveSpeech.classList.remove("hidden");

        const liveTimer = setInterval(() => {
          liveSec++;
          recorderTimer.textContent = formatTimestamp(liveSec);
        }, 1000);

        btnStopLiveSpeech.onclick = () => {
          clearInterval(liveTimer);
          try { recognitionInstance.stop(); } catch (_) {}
          micDot.classList.remove("recording");
          recorderTimer.classList.add("hidden");
          btnStopLiveSpeech.classList.add("hidden");
          btnLiveSpeech.classList.remove("hidden");

          const analysis = analyzeTranscriptText(liveSegments, liveSec);
          const newItem = {
            id: "live_" + Date.now(),
            title: "Reunión en Vivo " + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
            media_type: "audio",
            duration: liveSec,
            duration_formatted: formatTimestamp(liveSec),
            word_count: analysis.stats.word_count,
            language_name: languageSelect ? languageSelect.options[languageSelect.selectedIndex].text : "Español",
            segments: liveSegments,
            analysis,
            blobUrl: null
          };
          historyItems.unshift(newItem);
          saveLocalHistory();
          openItem(newItem);
          showToast("Reunión guardada.");
        };
      } catch (e) {
        alert("No se pudo iniciar el micrófono: " + e.message);
      }
    });
  }

  // =========================================================================
  // VISTA LECTOR Y REPRODUCTOR
  // =========================================================================
  function openItem(item) {
    pauseAllPlayers();
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

    if (item.blobUrl) {
      if (item.media_type === "video") {
        audioWrapper.classList.add("hidden");
        videoWrapper.classList.remove("hidden");
        videoPlayer.src = item.blobUrl;
        audioPlayer.removeAttribute("src");
      } else {
        videoWrapper.classList.add("hidden");
        audioWrapper.classList.remove("hidden");
        audioPlayer.src = item.blobUrl;
        videoPlayer.removeAttribute("src");
      }
      document.getElementById("mediaPlayerCard").classList.remove("hidden");
    } else {
      document.getElementById("mediaPlayerCard").classList.add("hidden");
    }

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
        <div class="reader-paragraph" data-start="${p.start}" data-end="${p.end}">
          <span class="para-ts">${p.timestamp}</span>
          <span class="para-text">${highlightQuery(p.text, query)}</span>
        </div>
      `).join("");

      paragraphsContainer.querySelectorAll(".reader-paragraph").forEach(el => {
        el.addEventListener("click", () => seekToSeconds(parseFloat(el.getAttribute("data-start"))));
      });
    }

    // 2. Segmentos
    segmentsContainer.innerHTML = segments.map((seg, idx) => `
      <div class="segment-row" data-start="${seg.start}" data-end="${seg.end}">
        <button class="segment-time-btn" data-seek="${seg.start}">${seg.timestamp}</button>
        <div class="segment-text" contenteditable="true" spellcheck="false" data-idx="${idx}">${highlightQuery(seg.text, query)}</div>
      </div>
    `).join("");

    segmentsContainer.querySelectorAll(".segment-time-btn").forEach(btn => {
      btn.addEventListener("click", () => seekToSeconds(parseFloat(btn.getAttribute("data-seek"))));
    });

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
        <button class="segment-time-btn" data-seek="${kp.start}">${kp.timestamp}</button>
        <span>${highlightQuery(kp.text, query)}</span>
      </li>
    `).join("");

    document.getElementById("tabSummary").querySelectorAll(".segment-time-btn").forEach(btn => {
      btn.addEventListener("click", () => seekToSeconds(parseFloat(btn.getAttribute("data-seek"))));
    });

    keywordsCloud.innerHTML = (analysis.keywords || []).map(kw => `
      <span class="keyword-chip">${escapeHtml(kw.word)} <small>×${kw.count}</small></span>
    `).join("");

    if (analysis.questions && analysis.questions.length > 0) {
      questionsBlock.classList.remove("hidden");
      questionsList.innerHTML = analysis.questions.map(q => `
        <li>
          <button class="segment-time-btn" data-seek="${q.start}">${q.timestamp}</button>
          <span>${escapeHtml(q.text)}</span>
        </li>
      `).join("");
    } else {
      questionsBlock.classList.add("hidden");
    }
  }

  // Sincronización Multimedia
  function onMediaTimeUpdate(e) {
    const cur = e.target.currentTime;
    const autoScroll = chkAutoScroll ? chkAutoScroll.checked : true;

    paragraphsContainer.querySelectorAll(".reader-paragraph").forEach(el => {
      const s = parseFloat(el.getAttribute("data-start"));
      const end = parseFloat(el.getAttribute("data-end"));
      const active = (cur >= s && cur <= end + 0.3);
      el.classList.toggle("active", active);
      if (active && autoScroll && !document.getElementById("tabParagraphs").classList.contains("hidden")) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    segmentsContainer.querySelectorAll(".segment-row").forEach(el => {
      const s = parseFloat(el.getAttribute("data-start"));
      const end = parseFloat(el.getAttribute("data-end"));
      const active = (cur >= s && cur <= end + 0.2);
      el.classList.toggle("active", active);
      if (active && autoScroll && !document.getElementById("tabSegments").classList.contains("hidden")) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }
  if (audioPlayer) audioPlayer.addEventListener("timeupdate", onMediaTimeUpdate);
  if (videoPlayer) videoPlayer.addEventListener("timeupdate", onMediaTimeUpdate);

  if (btnRewind5) btnRewind5.addEventListener("click", () => { const p = getActivePlayer(); if (p) p.currentTime = Math.max(0, p.currentTime - 5); });
  if (btnForward5) btnForward5.addEventListener("click", () => { const p = getActivePlayer(); if (p) p.currentTime += 5; });
  if (playbackSpeedSelect) {
    playbackSpeedSelect.addEventListener("change", () => {
      const r = parseFloat(playbackSpeedSelect.value) || 1;
      if (audioPlayer) audioPlayer.playbackRate = r;
      if (videoPlayer) videoPlayer.playbackRate = r;
    });
  }

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

  // EXPORTACIONES CLIENT-SIDE (DESCARGA DIRECTA EN EL NAVEGADOR)
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
