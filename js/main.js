// 主线程：UI 交互、任务调度（Worker 池）、下载、历史记录
'use strict';

(() => {
  const $ = (sel) => document.querySelector(sel);

  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  const listPanel = $('#listPanel');
  const fileList = $('#fileList');
  const statsSummary = $('#statsSummary');
  const overallProgress = $('#overallProgress');
  const btnDownloadAll = $('#btnDownloadAll');
  const btnReprocess = $('#btnReprocess');
  const btnClear = $('#btnClear');
  const btnClearHistory = $('#btnClearHistory');
  const historyList = $('#historyList');
  const historyEmpty = $('#historyEmpty');
  const tpl = $('#tplFileItem');

  const optFormat = $('#optFormat');
  const optQuality = $('#optQuality');
  const optScale = $('#optScale');
  const optMaxDim = $('#optMaxDim');
  const qualityValue = $('#qualityValue');

  const WORKER_COUNT = Math.min(4, navigator.hardwareConcurrency || 2);
  const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif|tiff?|svg|ico|heic|heif)$/i;

  // 部分系统拖拽/选择文件时 MIME 为空，用扩展名兜底判断
  function isImageFile(file) {
    if (file.type) return file.type.startsWith('image/');
    return IMAGE_EXT_RE.test(file.name);
  }

  let items = [];
  let nextId = 1;
  const taskQueue = [];
  const pending = new Map(); // id -> item
  const workers = [];

  // ---------- Worker 池 ----------
  function createWorker() {
    const worker = new Worker('js/worker.js');
    worker.busy = false;
    worker.currentItem = null;
    worker.onmessage = (e) => {
      worker.busy = false;
      worker.currentItem = null;
      handleResult(e.data);
      pump();
    };
    worker.onerror = (e) => {
      worker.busy = false;
      if (worker.currentItem) {
        pending.delete(worker.currentItem.id);
        setError(worker.currentItem, '处理失败：' + (e.message || '未知错误'));
        worker.currentItem = null;
      }
      console.error('Worker error:', e.message);
      pump();
    };
    return worker;
  }

  function pump() {
    for (const worker of workers) {
      if (worker.busy || taskQueue.length === 0) continue;
      const item = taskQueue.shift();
      worker.busy = true;
      worker.currentItem = item;
      pending.set(item.id, item);
      worker.postMessage({ id: item.id, file: item.file, options: getOptions() });
    }
    updateProgress();
  }

  function getOptions() {
    return {
      format: optFormat.value,
      quality: parseInt(optQuality.value, 10) / 100,
      scale: parseFloat(optScale.value),
      maxDim: Math.max(0, parseInt(optMaxDim.value, 10) || 0),
    };
  }

  // ---------- 结果处理 ----------
  function handleResult(msg) {
    const item = pending.get(msg.id);
    pending.delete(msg.id);
    if (!item) return;

    if (!msg.ok) {
      setError(item, msg.error || '处理失败');
      updateProgress();
      return;
    }

    const outBlob = new Blob([msg.buffer], { type: msg.type });
    const picked = pickResult(item.file, outBlob, msg.type);

    item.resultBlob = picked.blob;
    item.resultType = msg.type;
    item.keptOriginal = picked.keptOriginal;
    item.note = picked.note;
    item.outWidth = msg.width;
    item.outHeight = msg.height;
    item.status = 'done';
    renderItemDone(item);
    saveHistory(item);
    updateProgress();
  }

  // 压缩后体积反而变大：同格式时保留原图，转换格式时保留转换结果但给出提示
  function pickResult(file, outBlob, outType) {
    if (outBlob.size >= file.size) {
      if (file.type === outType) {
        return { blob: file, keptOriginal: true, note: '压缩后更大，已保留原图' };
      }
      return { blob: outBlob, keptOriginal: false, note: '转换后体积增大' };
    }
    return { blob: outBlob, keptOriginal: false, note: '' };
  }

  // ---------- 文件接收 ----------
  function acceptFiles(fileListObj) {
    const files = Array.from(fileListObj || []);
    if (files.length === 0) return;
    listPanel.hidden = false;

    for (const file of files) {
      const item = {
        id: nextId++,
        file,
        status: 'waiting',
        el: buildItemElement(file),
      };
      items.push(item);
      fileList.appendChild(item.el);

      if (!isImageFile(file)) {
        setError(item, '不支持的文件类型（非图片）');
        continue;
      }
      item.status = 'queued';
      setStatus(item, '排队中…');
      taskQueue.push(item);
    }
    pump();
  }

  // ---------- UI 渲染 ----------
  function buildItemElement(file) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.name').textContent = file.name;
    node.querySelector('.name').title = file.name;
    node.querySelector('.meta').textContent = `原始大小 ${formatSize(file.size)}`;
    node.querySelector('.btn-download').addEventListener('click', () => downloadItem(node._item));
    return node;
  }

  function setStatus(item, text) {
    const line = item.el.querySelector('.status-line');
    line.textContent = text;
    line.classList.remove('error-text');
  }

  function setError(item, message) {
    item.status = 'error';
    item.el.classList.add('error');
    const line = item.el.querySelector('.status-line');
    line.textContent = message;
    line.classList.add('error-text');
    const badge = item.el.querySelector('.badge');
    badge.textContent = '失败';
    badge.classList.add('err');
  }

  function renderItemDone(item) {
    const { file, resultBlob, el } = item;
    el._item = item;

    const url = URL.createObjectURL(resultBlob);
    item.objectUrl = url;
    const img = el.querySelector('.thumb img');
    img.src = url;
    img.onload = () => img.classList.add('loaded');
    el.querySelector('.thumb-placeholder').style.display = 'none';

    const origSize = file.size;
    const newSize = resultBlob.size;
    const ratio = ((1 - newSize / origSize) * 100).toFixed(1);
    const savedCls = newSize < origSize ? 'saved' : 'grown';
    const arrow = newSize < origSize ? '↓' : '↑';

    el.querySelector('.meta').innerHTML =
      `${formatSize(origSize)} → <strong>${formatSize(newSize)}</strong> ` +
      `<span class="${savedCls}">${arrow} ${Math.abs(ratio)}%</span> · ` +
      `${item.outWidth}×${item.outHeight} · ${extOf(item.resultType).toUpperCase()}`;

    const badge = el.querySelector('.badge');
    if (item.note) {
      badge.textContent = item.note;
      badge.classList.add('warn');
    } else {
      badge.textContent = '完成';
      badge.classList.add('ok');
    }

    setStatus(item, '');
    el.querySelector('.btn-download').disabled = false;
  }

  function updateProgress() {
    const total = items.length;
    if (total === 0) return;
    const finished = items.filter((i) => i.status === 'done' || i.status === 'error').length;
    overallProgress.style.width = `${(finished / total) * 100}%`;

    const doneItems = items.filter((i) => i.status === 'done');
    btnDownloadAll.disabled = doneItems.length === 0;

    if (doneItems.length > 0) {
      const origTotal = doneItems.reduce((s, i) => s + i.file.size, 0);
      const newTotal = doneItems.reduce((s, i) => s + i.resultBlob.size, 0);
      const saved = origTotal - newTotal;
      statsSummary.textContent =
        `${doneItems.length}/${total} 完成 · 共 ${formatSize(origTotal)} → ${formatSize(newTotal)}` +
        (saved > 0 ? ` · 节省 ${formatSize(saved)}` : '');
    } else {
      statsSummary.textContent = `${finished}/${total} 完成`;
    }
  }

  // ---------- 下载 ----------
  function outputName(item) {
    const base = item.file.name.replace(/\.[^.]+$/, '');
    return `${base}.${extOf(item.resultType)}`;
  }

  function extOf(mime) {
    return MIME_EXT[mime] || 'png';
  }

  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function downloadItem(item) {
    if (!item || !item.resultBlob) return;
    triggerDownload(item.resultBlob, outputName(item));
  }

  async function downloadAll() {
    const doneItems = items.filter((i) => i.status === 'done');
    if (doneItems.length === 0) return;
    btnDownloadAll.disabled = true;
    btnDownloadAll.textContent = '打包中…';
    try {
      const zip = new ZipBuilder.Builder();
      const usedNames = new Set();
      for (const item of doneItems) {
        let name = outputName(item);
        let n = 1;
        while (usedNames.has(name)) {
          name = outputName(item).replace(/(\.[^.]+)$/, `_${n++}$1`);
        }
        usedNames.add(name);
        await zip.add(name, item.resultBlob);
      }
      const blob = zip.build();
      triggerDownload(blob, `compressed-images-${Date.now()}.zip`);
    } finally {
      btnDownloadAll.disabled = false;
      btnDownloadAll.textContent = '打包下载 (ZIP)';
    }
  }

  // ---------- 历史记录 ----------
  async function makeThumb(blob) {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = 96;
      const ratio = Math.min(size / bitmap.width, size / bitmap.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
    } catch (e) {
      return null;
    }
  }

  async function saveHistory(item) {
    try {
      const thumb = await makeThumb(item.resultBlob);
      await HistoryDB.add({
        name: item.file.name,
        originalSize: item.file.size,
        compressedSize: item.resultBlob.size,
        format: item.resultType,
        width: item.outWidth,
        height: item.outHeight,
        keptOriginal: item.keptOriginal,
        timestamp: Date.now(),
        thumb,
      });
      renderHistory();
    } catch (e) {
      console.warn('历史记录保存失败:', e);
    }
  }

  const historyUrls = [];
  async function renderHistory() {
    let records = [];
    try {
      records = await HistoryDB.getAll();
    } catch (e) {
      return;
    }
    historyUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    historyList.innerHTML = '';
    historyEmpty.style.display = records.length === 0 ? '' : 'none';

    for (const rec of records) {
      const li = document.createElement('li');
      if (rec.thumb) {
        const img = document.createElement('img');
        img.className = 'h-thumb';
        const url = URL.createObjectURL(rec.thumb);
        historyUrls.push(url);
        img.src = url;
        li.appendChild(img);
      }
      const name = document.createElement('span');
      name.className = 'h-name';
      name.textContent = rec.name;
      name.title = rec.name;
      const meta = document.createElement('span');
      meta.className = 'h-meta';
      const pct = ((1 - rec.compressedSize / rec.originalSize) * 100).toFixed(0);
      meta.textContent = `${formatSize(rec.originalSize)} → ${formatSize(rec.compressedSize)} (${pct}%)`;
      const time = document.createElement('span');
      time.className = 'h-time';
      time.textContent = new Date(rec.timestamp).toLocaleString();
      li.append(name, meta, time);
      historyList.appendChild(li);
    }
  }

  // ---------- 工具 ----------
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function clearAll() {
    for (const item of items) {
      if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    }
    items = [];
    taskQueue.length = 0;
    pending.clear();
    fileList.innerHTML = '';
    listPanel.hidden = true;
    overallProgress.style.width = '0%';
    statsSummary.textContent = '';
    btnDownloadAll.disabled = true;
  }

  // ---------- 事件绑定 ----------
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    acceptFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone.addEventListener('drop', (e) => acceptFiles(e.dataTransfer.files));
  // 阻止浏览器默认行为（拖入页面直接打开图片）
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  optQuality.addEventListener('input', () => {
    qualityValue.textContent = `${optQuality.value}%`;
  });

  btnReprocess.addEventListener('click', () => {
    const redo = items.filter((i) => i.status === 'done' || i.status === 'error');
    for (const item of redo) {
      if (!isImageFile(item.file)) continue;
      if (item.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
        item.objectUrl = null;
      }
      item.status = 'queued';
      item.resultBlob = null;
      item.note = '';
      item.el.classList.remove('error');
      item.el.querySelector('.badge').textContent = '';
      item.el.querySelector('.badge').className = 'badge';
      item.el.querySelector('.btn-download').disabled = true;
      item.el.querySelector('.meta').textContent = `原始大小 ${formatSize(item.file.size)}`;
      setStatus(item, '排队中…');
      taskQueue.push(item);
    }
    pump();
  });

  btnDownloadAll.addEventListener('click', downloadAll);
  btnClear.addEventListener('click', clearAll);
  btnClearHistory.addEventListener('click', async () => {
    await HistoryDB.clear();
    renderHistory();
  });

  // ---------- 启动 ----------
  for (let i = 0; i < WORKER_COUNT; i++) workers.push(createWorker());
  renderHistory();

  // 测试钩子
  window.ImageCompressorTest = { pickResult, formatSize, isImageFile };
})();
