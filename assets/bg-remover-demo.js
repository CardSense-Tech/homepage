(() => {
  const API_ROOT = '/api';

  const MAX_IMAGES_PER_DAY = 25;
  const STORAGE_KEY = 'cardsense_bgremover_quota_v1';

  const state = {
    singleFile: null,
    bulkFiles: [],
    quota: null,
  };

  const els = {
    statusIndicator: null,
    statusText: null,
    quotaText: null,

    tabButtons: [],
    tabPanels: [],

    singleInput: null,
    singleUpload: null,
    singlePreview: null,
    singleProcess: null,
    singleProgress: null,
    singleProgressFill: null,
    singleProgressText: null,
    singleResults: null,

    bulkInput: null,
    bulkUpload: null,
    bulkPreview: null,
    bulkProcess: null,
    bulkClear: null,
    bulkProgress: null,
    bulkProgressFill: null,
    bulkProgressText: null,
    bulkResults: null,

    jobIdInput: null,
    jobCheck: null,
    jobResults: null,
  };

  function todayKey() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function loadQuota() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { day: todayKey(), used: 0 };
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.day !== todayKey() || typeof parsed.used !== 'number') {
        return { day: todayKey(), used: 0 };
      }
      return parsed;
    } catch {
      return { day: todayKey(), used: 0 };
    }
  }

  function saveQuota(next) {
    state.quota = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    renderQuota();
  }

  function remainingQuota() {
    const used = state.quota?.used ?? 0;
    return Math.max(0, MAX_IMAGES_PER_DAY - used);
  }

  function renderQuota() {
    if (!els.quotaText) return;
    els.quotaText.textContent = `Daily demo quota: ${remainingQuota()} / ${MAX_IMAGES_PER_DAY} images remaining (per browser).`;
  }

  function consumeQuota(imageCount) {
    const nextUsed = (state.quota?.used ?? 0) + imageCount;
    saveQuota({ day: todayKey(), used: nextUsed });
  }

  function canUse(imageCount) {
    return remainingQuota() >= imageCount;
  }

  function showInlineMessage(container, type, message) {
    if (!container) return;
    container.innerHTML = `
      <div class="demo-message ${type === 'error' ? 'is-error' : 'is-success'}" role="status">
        ${escapeHtml(message)}
      </div>
    `;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function setProgress(progressEls, pct, text) {
    if (progressEls.container) progressEls.container.classList.remove('hidden');
    if (progressEls.fill) progressEls.fill.style.width = `${pct}%`;
    if (progressEls.text) progressEls.text.textContent = text;
  }

  function hideProgress(progressEls) {
    if (progressEls.container) progressEls.container.classList.add('hidden');
    if (progressEls.fill) progressEls.fill.style.width = '0%';
  }

  function validateFile(file) {
    const maxSize = 10 * 1024 * 1024;
    if (!file.type.startsWith('image/')) return 'Only image files are supported.';
    if (file.size > maxSize) return 'File size must be less than 10MB.';
    return null;
  }

  function createFileRow(file, removeHandler) {
    const fileSize = (file.size / 1024 / 1024).toFixed(2);
    const row = document.createElement('div');
    row.className = 'demo-file-item';

    const info = document.createElement('div');
    info.className = 'demo-file-info';
    info.innerHTML = `
      <div class="demo-file-name">${escapeHtml(file.name)}</div>
      <div class="small muted">${fileSize} MB</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'demo-file-actions';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-small';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', removeHandler);

    actions.appendChild(removeBtn);
    row.appendChild(info);
    row.appendChild(actions);

    return row;
  }

  function switchTab(tabName) {
    els.tabButtons.forEach(btn => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    els.tabPanels.forEach(panel => {
      panel.classList.toggle('is-active', panel.dataset.tabPanel === tabName);
    });
  }

  async function checkApiStatus() {
    try {
      const response = await fetch(`${API_ROOT}/health`, { cache: 'no-store' });
      if (!response.ok) throw new Error('offline');
      const data = await response.json().catch(() => ({}));

      els.statusIndicator?.classList.add('is-online');
      if (els.statusText) {
        els.statusText.textContent = `API Online${data?.status ? ` — ${data.status}` : ''}`;
      }
    } catch {
      els.statusIndicator?.classList.remove('is-online');
      if (els.statusText) els.statusText.textContent = 'API Offline — start the server / check deployment';
    }
  }

  function wireDragAndDrop(targetEl, onFiles) {
    if (!targetEl) return;

    targetEl.addEventListener('dragover', (event) => {
      event.preventDefault();
      targetEl.classList.add('is-dragover');
    });

    targetEl.addEventListener('dragleave', (event) => {
      event.preventDefault();
      targetEl.classList.remove('is-dragover');
    });

    targetEl.addEventListener('drop', (event) => {
      event.preventDefault();
      targetEl.classList.remove('is-dragover');
      const files = Array.from(event.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'));
      if (files.length) onFiles(files);
    });
  }

  function renderSinglePreview() {
    if (!els.singlePreview) return;
    els.singlePreview.innerHTML = '';

    if (!state.singleFile) {
      els.singlePreview.classList.add('hidden');
      if (els.singleProcess) els.singleProcess.disabled = true;
      return;
    }

    const row = createFileRow(state.singleFile, () => clearSingle());
    els.singlePreview.appendChild(row);
    els.singlePreview.classList.remove('hidden');
    if (els.singleProcess) els.singleProcess.disabled = false;
  }

  function renderBulkPreview() {
    if (!els.bulkPreview) return;
    els.bulkPreview.innerHTML = '';

    if (state.bulkFiles.length === 0) {
      els.bulkPreview.classList.add('hidden');
      if (els.bulkProcess) els.bulkProcess.disabled = true;
      return;
    }

    state.bulkFiles.forEach((file, index) => {
      const row = createFileRow(file, () => {
        state.bulkFiles.splice(index, 1);
        renderBulkPreview();
      });
      els.bulkPreview.appendChild(row);
    });

    els.bulkPreview.classList.remove('hidden');
    if (els.bulkProcess) els.bulkProcess.disabled = false;
  }

  function clearSingle() {
    state.singleFile = null;
    if (els.singleInput) els.singleInput.value = '';
    renderSinglePreview();
  }

  function clearBulk() {
    state.bulkFiles = [];
    if (els.bulkInput) els.bulkInput.value = '';
    renderBulkPreview();
  }

  function downloadBase64Png(base64Data, filename) {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${base64Data}`;
    link.download = `processed_${filename.replace(/\.[^/.]+$/, '')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function renderSingleResult(file, result) {
    if (!els.singleResults) return;

    if (!result?.success) {
      els.singleResults.innerHTML = `
        <div class="card">
          <h3>${escapeHtml(file.name)}</h3>
          <p class="muted">Processing failed.</p>
        </div>
      `;
      return;
    }

    els.singleResults.innerHTML = `
      <div class="card">
        <h3>${escapeHtml(file.name)}</h3>
        <p class="muted">Background removed successfully.</p>
        <div class="demo-result-images">
          <div class="demo-image">
            <img src="${URL.createObjectURL(file)}" alt="Original image" />
            <div class="demo-image-label">Original</div>
          </div>
          <div class="demo-image">
            <img src="data:image/png;base64,${result.processed_image}" alt="Processed image" />
            <div class="demo-image-label">Processed</div>
          </div>
        </div>
        <div class="btn-row" style="margin-top: 1rem;">
          <button type="button" class="btn btn-primary" id="demoDownloadSingle">Download Result</button>
        </div>
      </div>
    `;

    const downloadBtn = document.getElementById('demoDownloadSingle');
    downloadBtn?.addEventListener('click', () => downloadBase64Png(result.processed_image, file.name));
  }

  function renderBulkResults(files, results) {
    if (!els.bulkResults) return;

    const cards = results.map((res, idx) => {
      const file = files[idx];
      if (!res?.success) {
        return `
          <div class="card">
            <h3>${escapeHtml(file.name)}</h3>
            <p class="muted">Processing failed.</p>
          </div>
        `;
      }

      const downloadId = `demoDownload_${idx}`;

      return `
        <div class="card">
          <h3>${escapeHtml(file.name)}</h3>
          <p class="muted">Background removed successfully.</p>
          <div class="demo-result-images">
            <div class="demo-image">
              <img src="${URL.createObjectURL(file)}" alt="Original image" />
              <div class="demo-image-label">Original</div>
            </div>
            <div class="demo-image">
              <img src="data:image/png;base64,${res.processed_image}" alt="Processed image" />
              <div class="demo-image-label">Processed</div>
            </div>
          </div>
          <div class="btn-row" style="margin-top: 1rem;">
            <button type="button" class="btn btn-primary" id="${downloadId}">Download</button>
          </div>
        </div>
      `;
    }).join('');

    els.bulkResults.innerHTML = `<div class="grid grid-2">${cards}</div>`;

    results.forEach((res, idx) => {
      if (!res?.success) return;
      const btn = document.getElementById(`demoDownload_${idx}`);
      btn?.addEventListener('click', () => downloadBase64Png(res.processed_image, files[idx].name));
    });
  }

  async function processSingle() {
    if (!state.singleFile) return;

    if (!canUse(1)) {
      showInlineMessage(els.singleResults, 'error', 'Daily demo quota reached for this browser. Please contact us for higher-volume access.');
      return;
    }

    const validationError = validateFile(state.singleFile);
    if (validationError) {
      showInlineMessage(els.singleResults, 'error', validationError);
      return;
    }

    if (els.singleProcess) els.singleProcess.disabled = true;
    els.singleResults.innerHTML = '';

    const progressEls = {
      container: els.singleProgress,
      fill: els.singleProgressFill,
      text: els.singleProgressText,
    };

    try {
      setProgress(progressEls, 20, 'Uploading…');
      const formData = new FormData();
      formData.append('file', state.singleFile);

      const response = await fetch(`${API_ROOT}/process_sync`, {
        method: 'POST',
        body: formData,
      });

      setProgress(progressEls, 80, 'Processing…');

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || 'Processing failed');
      }

      const result = await response.json();
      setProgress(progressEls, 100, 'Done');
      renderSingleResult(state.singleFile, result);
      consumeQuota(1);
    } catch (error) {
      showInlineMessage(els.singleResults, 'error', `Error: ${error?.message ?? 'Request failed'}`);
    } finally {
      if (els.singleProcess) els.singleProcess.disabled = false;
      setTimeout(() => hideProgress(progressEls), 1200);
    }
  }

  async function processBulk() {
    if (state.bulkFiles.length === 0) return;

    const imageCount = state.bulkFiles.length;
    if (!canUse(imageCount)) {
      showInlineMessage(
        els.bulkResults,
        'error',
        `Daily demo quota reached for this browser. This batch needs ${imageCount} images, but only ${remainingQuota()} remaining today.`
      );
      return;
    }

    const invalid = state.bulkFiles.map(validateFile).find(Boolean);
    if (invalid) {
      showInlineMessage(els.bulkResults, 'error', invalid);
      return;
    }

    if (els.bulkProcess) els.bulkProcess.disabled = true;
    els.bulkResults.innerHTML = '';

    const progressEls = {
      container: els.bulkProgress,
      fill: els.bulkProgressFill,
      text: els.bulkProgressText,
    };

    try {
      setProgress(progressEls, 20, 'Uploading batch…');
      const formData = new FormData();
      state.bulkFiles.forEach(file => formData.append('files', file));

      const response = await fetch(`${API_ROOT}/batch_sync`, {
        method: 'POST',
        body: formData,
      });

      setProgress(progressEls, 80, 'Processing…');

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || 'Batch processing failed');
      }

      const result = await response.json();
      setProgress(progressEls, 100, 'Done');

      const results = Array.isArray(result?.results) ? result.results : [];
      renderBulkResults(state.bulkFiles, results);
      consumeQuota(imageCount);
    } catch (error) {
      showInlineMessage(els.bulkResults, 'error', `Error: ${error?.message ?? 'Request failed'}`);
    } finally {
      if (els.bulkProcess) els.bulkProcess.disabled = false;
      setTimeout(() => hideProgress(progressEls), 1200);
    }
  }

  async function checkJobStatus() {
    const jobId = els.jobIdInput?.value?.trim();
    if (!jobId) {
      showInlineMessage(els.jobResults, 'error', 'Enter a Job ID.');
      return;
    }

    try {
      els.jobResults.innerHTML = '';
      const response = await fetch(`${API_ROOT}/status/${encodeURIComponent(jobId)}`);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || 'Job not found');
      }
      const status = await response.json();
      els.jobResults.innerHTML = `
        <div class="card">
          <h3>Job ${escapeHtml(status.job_id ?? jobId)}</h3>
          <p class="muted">Status: ${escapeHtml(status.status ?? 'unknown')}</p>
          ${typeof status.progress === 'number' ? `<p class="small">Progress: ${status.progress}%</p>` : ''}
          ${status.message ? `<p class="small">${escapeHtml(status.message)}</p>` : ''}
          ${status.error ? `<div class="demo-message is-error">${escapeHtml(status.error)}</div>` : ''}
        </div>
      `;
    } catch (error) {
      showInlineMessage(els.jobResults, 'error', `Error: ${error?.message ?? 'Request failed'}`);
    }
  }

  function init() {
    els.statusIndicator = document.getElementById('demoStatusIndicator');
    els.statusText = document.getElementById('demoStatusText');
    els.quotaText = document.getElementById('demoQuotaText');

    els.tabButtons = Array.from(document.querySelectorAll('[data-demo-tab]'));
    els.tabPanels = Array.from(document.querySelectorAll('[data-demo-panel]'));

    els.singleInput = document.getElementById('demoSingleFile');
    els.singleUpload = document.getElementById('demoSingleUpload');
    els.singlePreview = document.getElementById('demoSinglePreview');
    els.singleProcess = document.getElementById('demoProcessSingle');
    els.singleProgress = document.getElementById('demoSingleProgress');
    els.singleProgressFill = document.getElementById('demoSingleProgressFill');
    els.singleProgressText = document.getElementById('demoSingleProgressText');
    els.singleResults = document.getElementById('demoSingleResults');

    els.bulkInput = document.getElementById('demoBulkFiles');
    els.bulkUpload = document.getElementById('demoBulkUpload');
    els.bulkPreview = document.getElementById('demoBulkPreview');
    els.bulkProcess = document.getElementById('demoProcessBulk');
    els.bulkClear = document.getElementById('demoClearBulk');
    els.bulkProgress = document.getElementById('demoBulkProgress');
    els.bulkProgressFill = document.getElementById('demoBulkProgressFill');
    els.bulkProgressText = document.getElementById('demoBulkProgressText');
    els.bulkResults = document.getElementById('demoBulkResults');

    els.jobIdInput = document.getElementById('demoJobId');
    els.jobCheck = document.getElementById('demoCheckJob');
    els.jobResults = document.getElementById('demoJobResults');

    state.quota = loadQuota();
    renderQuota();

    els.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    switchTab('single');

    if (els.singleUpload && els.singleInput) {
      els.singleUpload.addEventListener('click', () => els.singleInput.click());
      wireDragAndDrop(els.singleUpload, (files) => {
        state.singleFile = files[0];
        renderSinglePreview();
      });
      els.singleInput.addEventListener('change', () => {
        const file = els.singleInput.files?.[0];
        if (file) state.singleFile = file;
        renderSinglePreview();
      });
    }

    if (els.bulkUpload && els.bulkInput) {
      els.bulkUpload.addEventListener('click', () => els.bulkInput.click());
      wireDragAndDrop(els.bulkUpload, (files) => {
        state.bulkFiles = [...state.bulkFiles, ...files];
        renderBulkPreview();
      });
      els.bulkInput.addEventListener('change', () => {
        const files = Array.from(els.bulkInput.files ?? []);
        state.bulkFiles = [...state.bulkFiles, ...files];
        renderBulkPreview();
      });
    }

    els.singleProcess?.addEventListener('click', processSingle);
    els.bulkProcess?.addEventListener('click', processBulk);
    els.bulkClear?.addEventListener('click', clearBulk);
    els.jobCheck?.addEventListener('click', checkJobStatus);

    renderSinglePreview();
    renderBulkPreview();

    checkApiStatus();
    setInterval(checkApiStatus, 30000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
