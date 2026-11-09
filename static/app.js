(() => {
  let currentFile = null;
  let currentItem = null;
  let historyItems = [];
  let pollInterval = null;
  let readerFontSize = 1.05;
  let segmentsModified = false;

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

  const languageSelect = document.getElementById("languageSelect");
  const btnStartTranscribe = document.getElementById("btnStartTranscribe");

  const progressCard = document.getElementById("progressCard");
  const progressStatusTitle = document.getElementById("progressStatusTitle");
  const progressPct = document.getElementById("progressPct");
  const progressBarFill = document.getElementById("progressBarFill");
  const progressMessage = document.getElementById("progressMessage");
  const livePreviewBox = document.getElementById("livePreviewBox");
  const livePreviewText = document.getElementById("livePreviewText");

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
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.add("hidden"), duration);
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
  btnThemeToggle.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "dark" ? "light" : "dark");
  });

  // NAVEGACIÓN
  function showUploadView() {
    pauseAllPlayers();
    currentItem = null;
    readerView.classList.add("hidden");
    uploadView.classList.remove("hidden");
    loadHistory();
  }
  btnNewTranscription.addEventListener("click", showUploadView);

  // MANEJO DE ARCHIVOS
  function handleFileSelected(file) {
    if (!file) return;
    currentFile = file;
    selectedFileName.textContent = file.name;
    selectedFileSize.textContent = formatBytes(file.size);

    dropzone.classList.add("hidden");
    selectedFileBar.classList.remove("hidden");
    btnStartTranscribe.disabled = false;
  }

  function clearSelectedFile() {
    currentFile = null;
    fileInput.value = "";
    selectedFileBar.classList.add("hidden");
    dropzone.classList.remove("hidden");
    btnStartTranscribe.disabled = true;
  }

  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", e => {
    if (e.target.files && e.target.files[0]) handleFileSelected(e.target.files[0]);
  });
  dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", e => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileSelected(e.dataTransfer.files[0]);
  });
  btnClearFile.addEventListener("click", clearSelectedFile);

  // PROCESAMIENTO DIRECTO EN SERVIDOR (OFFLINE KALDI / DSP - RÁPIDO Y SILENCIOSO)
  btnStartTranscribe.addEventListener("click", async () => {
    if (!currentFile) return;

    btnStartTranscribe.disabled = true;
    progressCard.classList.remove("hidden");
    progressPct.textContent = "10%";
    progressBarFill.style.width = "10%";
    progressStatusTitle.textContent = "Subiendo archivo...";
    progressMessage.textContent = "Iniciando algoritmo fonético de alta velocidad...";
    livePreviewBox.classList.add("hidden");

    const formData = new FormData();
    formData.append("file", currentFile);
    formData.append("model_size", "vosk_offline"); // Algoritmo offline de máxima velocidad
    formData.append("language", languageSelect.value || "es");
    formData.append("translate_to", "none");

    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Error al procesar el archivo.");
      }
      const data = await res.json();
      startPolling(data.job_id);
    } catch (err) {
      showToast(err.message);
      btnStartTranscribe.disabled = false;
      progressCard.classList.add("hidden");
    }
  });

  function startPolling(jobId) {
    clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const job = await res.json();

        const pct = job.progress || 0;
        progressPct.textContent = `${pct}%`;
        progressBarFill.style.width = `${pct}%`;
        progressMessage.textContent = job.message || "Procesando...";

        if (job.latest_text) {
          livePreviewBox.classList.remove("hidden");
          livePreviewText.textContent = `"${job.latest_text}"`;
        }

        if (job.status === "completed" && job.item) {
          clearInterval(pollInterval);
          progressCard.classList.add("hidden");
          clearSelectedFile();
          await loadHistory();
          openItem(job.item);
          showToast("Transcripción lista.");
        } else if (job.status === "error") {
          clearInterval(pollInterval);
          showToast(job.message || "Error al transcribir");
          btnStartTranscribe.disabled = false;
          progressCard.classList.add("hidden");
        }
      } catch (_) {}
    }, 500);
  }

  // BIBLIOTECA
  async function loadHistory() {
    try {
      const res = await fetch("/api/history");
      if (!res.ok) return;
      const data = await res.json();
      historyItems = data.items || [];
      renderHistoryList();
    } catch (_) {}
  }

  function renderHistoryList() {
    const q = (historySearchInput.value || "").trim().toLowerCase();
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
      el.addEventListener("click", async e => {
        if (e.target.closest(".history-delete-btn")) return;
        const id = el.getAttribute("data-id");
        const res = await fetch(`/api/items/${id}`);
        if (res.ok) openItem(await res.json());
      });
    });

    historyListEl.querySelectorAll(".history-delete-btn").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const id = btn.getAttribute("data-delete-id");
        if (!confirm("¿Eliminar transcripción?")) return;
        await fetch(`/api/items/${id}`, { method: "DELETE" });
        if (currentItem && currentItem.id === id) showUploadView();
        loadHistory();
      });
    });
  }

  historySearchInput.addEventListener("input", renderHistoryList);

  // VISTA LECTOR
  function openItem(item) {
    pauseAllPlayers();
    currentItem = item;
    segmentsModified = false;
    btnSaveSegmentEdits.classList.add("hidden");

    uploadView.classList.add("hidden");
    readerView.classList.remove("hidden");

    const stats = (item.analysis && item.analysis.stats) || {};
    docTitle.textContent = item.title || item.filename || "Reunión";
    metaLanguage.textContent = item.language_name || item.language || "Español";
    metaDuration.textContent = stats.duration_formatted || "00:00";
    metaWords.textContent = `${stats.word_count || 0} palabras`;
    if (metaReadingTime) metaReadingTime.textContent = `~${stats.reading_time_minutes || 1} min`;

    const mediaUrl = `/api/media/${item.id}`;
    if (item.media_type === "video") {
      audioWrapper.classList.add("hidden");
      videoWrapper.classList.remove("hidden");
      videoPlayer.src = mediaUrl;
      audioPlayer.removeAttribute("src");
    } else {
      videoWrapper.classList.add("hidden");
      audioWrapper.classList.remove("hidden");
      audioPlayer.src = mediaUrl;
      videoPlayer.removeAttribute("src");
    }

    renderReaderContent();
    renderHistoryList();
  }

  function renderReaderContent() {
    if (!currentItem) return;
    const query = (transcriptSearchInput.value || "").trim();
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

    // Párrafos
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

    // Segmentos
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
          btnSaveSegmentEdits.classList.remove("hidden");
        }
      });
    });

    // Resumen y Puntos Clave
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
    const autoScroll = chkAutoScroll.checked;

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
  audioPlayer.addEventListener("timeupdate", onMediaTimeUpdate);
  videoPlayer.addEventListener("timeupdate", onMediaTimeUpdate);

  btnRewind5.addEventListener("click", () => { const p = getActivePlayer(); p.currentTime = Math.max(0, p.currentTime - 5); });
  btnForward5.addEventListener("click", () => { const p = getActivePlayer(); p.currentTime += 5; });
  playbackSpeedSelect.addEventListener("change", () => {
    const r = parseFloat(playbackSpeedSelect.value) || 1;
    audioPlayer.playbackRate = r;
    videoPlayer.playbackRate = r;
  });

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

  transcriptSearchInput.addEventListener("input", renderReaderContent);

  btnFontDec.addEventListener("click", () => {
    readerFontSize = Math.max(0.85, readerFontSize - 0.08);
    document.documentElement.style.setProperty("--reader-font-size", `${readerFontSize}rem`);
  });
  btnFontInc.addEventListener("click", () => {
    readerFontSize = Math.min(1.5, readerFontSize + 0.08);
    document.documentElement.style.setProperty("--reader-font-size", `${readerFontSize}rem`);
  });

  docTitle.addEventListener("blur", async () => {
    if (!currentItem) return;
    const title = docTitle.textContent.trim();
    if (title && title !== currentItem.title) {
      await fetch(`/api/items/${currentItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      loadHistory();
    }
  });

  btnSaveSegmentEdits.addEventListener("click", async () => {
    if (!currentItem || !segmentsModified) return;
    await fetch(`/api/items/${currentItem.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: currentItem.segments })
    });
    segmentsModified = false;
    btnSaveSegmentEdits.classList.add("hidden");
    const res = await fetch(`/api/items/${currentItem.id}`);
    if (res.ok) openItem(await res.json());
    showToast("Guardado.");
  });

  btnCopyAll.addEventListener("click", async () => {
    if (!currentItem) return;
    const txt = currentItem.segments.map(s => `[${s.timestamp}] ${s.text}`).join("\n");
    await navigator.clipboard.writeText(txt);
    showToast("Copiado.");
  });

  btnCopySummary.addEventListener("click", async () => {
    if (!currentItem || !currentItem.analysis) return;
    await navigator.clipboard.writeText(currentItem.analysis.executive_summary || "");
    showToast("Resumen copiado.");
  });

  // Exportaciones
  btnExportTxt.addEventListener("click", () => {
    if (!currentItem) return;
    window.location.href = `/api/items/${currentItem.id}/export/txt?timestamps=${chkExportTimestamps.checked}`;
  });
  btnExportSrt.addEventListener("click", () => {
    if (!currentItem) return;
    window.location.href = `/api/items/${currentItem.id}/export/srt`;
  });
  btnExportDoc.addEventListener("click", () => {
    if (!currentItem) return;
    window.location.href = `/api/items/${currentItem.id}/export/docx?timestamps=${chkExportTimestamps.checked}`;
  });
  btnExportPdf.addEventListener("click", () => {
    if (!currentItem) return;
    window.location.href = `/api/items/${currentItem.id}/export/pdf?timestamps=${chkExportTimestamps.checked}`;
  });

  initTheme();
  loadHistory();
})();
