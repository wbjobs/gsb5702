/* 主线程：UI、任务队列、Worker 池、下载、历史 */
(function () {
  'use strict';

  var WORKER_COUNT = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
  var SUPPORTS_OFFSCREEN = typeof OffscreenCanvas !== 'undefined' &&
    typeof OffscreenCanvas.prototype.convertToBlob === 'function';

  var state = {
    items: [],        // {id, file, name, status, result, error, el}
    nextId: 1,
    queue: [],
    workers: [],
    processing: 0,
    batchStart: 0
  };

  // ---------- DOM ----------
  var $ = function (sel) { return document.querySelector(sel); };
  var dropZone = $('#dropZone');
  var fileInput = $('#fileInput');
  var formatSel = $('#format');
  var qualityInput = $('#quality');
  var qualityVal = $('#qualityVal');
  var resizeSel = $('#resize');
  var customSize = $('#customSize');
  var listEl = $('#list');
  var emptyTip = $('#emptyTip');
  var downloadAllBtn = $('#downloadAll');
  var clearBtn = $('#clearList');
  var statEl = $('#stat');
  var historyList = $('#historyList');
  var clearHistoryBtn = $('#clearHistory');

  // ---------- 工具 ----------
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function extOf(type) {
    return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type] || 'png';
  }

  function isImageFile(file) {
    if (file.type && file.type.indexOf('image/') === 0) return true;
    return /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name);
  }

  function getOptions() {
    var maxWidth = 0, maxHeight = 0;
    var v = resizeSel.value;
    if (v === 'custom') {
      maxWidth = parseInt($('#customW').value, 10) || 0;
      maxHeight = parseInt($('#customH').value, 10) || 0;
    } else if (v !== 'original') {
      maxWidth = maxHeight = parseInt(v, 10);
    }
    return {
      format: formatSel.value,
      quality: parseInt(qualityInput.value, 10) / 100,
      maxWidth: maxWidth,
      maxHeight: maxHeight
    };
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  // ---------- Worker 池 ----------
  function createPool() {
    if (!SUPPORTS_OFFSCREEN) return;
    for (var i = 0; i < WORKER_COUNT; i++) {
      var w = new Worker('js/worker.js');
      w.onmessage = onWorkerMessage;
      w.onerror = function () { pumpQueue(); };
      state.workers.push({ worker: w, busy: false });
    }
  }

  function onWorkerMessage(e) {
    var msg = e.data;
    var slot = state.workers.find(function (s) { return s.currentId === msg.id; });
    if (slot) { slot.busy = false; slot.currentId = null; }
    var item = state.items.find(function (it) { return it.id === msg.id; });
    if (item) {
      if (msg.ok) finishItem(item, msg.result);
      else failItem(item, msg.error);
    }
    pumpQueue();
  }

  // ---------- 主线程兜底（无 OffscreenCanvas 时） ----------
  function processOnMainThread(file, options) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var targetType = options.format !== 'original' ? 'image/' + options.format
            : (['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) >= 0 ? file.type : 'image/png');
          var w = img.naturalWidth, h = img.naturalHeight;
          if (options.maxWidth > 0 && w > options.maxWidth) { h = Math.round(h * options.maxWidth / w); w = options.maxWidth; }
          if (options.maxHeight > 0 && h > options.maxHeight) { w = Math.round(w * options.maxHeight / h); h = options.maxHeight; }
          var biggest = Math.max(w, h);
          if (biggest > 16000) { var r = 16000 / biggest; w = Math.round(w * r); h = Math.round(h * r); }
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, w);
          canvas.height = Math.max(1, h);
          var ctx = canvas.getContext('2d');
          if (targetType === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height); // <img> 自动应用 EXIF 方向
          canvas.toBlob(function (blob) {
            if (!blob) return reject(new Error('编码失败'));
            var keptOriginal = false;
            if (blob.size >= file.size && targetType === file.type) { blob = file; keptOriginal = true; }
            resolve({
              blob: blob, width: canvas.width, height: canvas.height, type: targetType,
              keptOriginal: keptOriginal, larger: !keptOriginal && blob.size > file.size
            });
          }, targetType, targetType === 'image/png' ? undefined : options.quality);
        } catch (err) { reject(err); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
      img.src = url;
    });
  }

  // ---------- 队列 ----------
  function pumpQueue() {
    updateStat();
    if (state.queue.length === 0) {
      if (state.processing === 0 && state.batchStart) {
        var cost = ((performance.now() - state.batchStart) / 1000).toFixed(1);
        statEl.textContent += '，本批耗时 ' + cost + 's';
        state.batchStart = 0;
      }
      return;
    }
    if (!state.batchStart) state.batchStart = performance.now();

    if (SUPPORTS_OFFSCREEN) {
      var free = state.workers.find(function (s) { return !s.busy; });
      if (!free) return;
      var item = state.queue.shift();
      free.busy = true;
      free.currentId = item.id;
      state.processing++;
      item.status = 'processing';
      renderItemStatus(item);
      free.worker.postMessage({ id: item.id, file: item.file, options: getOptions() });
      pumpQueue();
    } else {
      // 主线程兜底：逐张处理，setTimeout 让出渲染
      var next = state.queue.shift();
      state.processing++;
      next.status = 'processing';
      renderItemStatus(next);
      setTimeout(function () {
        processOnMainThread(next.file, getOptions())
          .then(function (result) { finishItem(next, result); })
          .catch(function (err) { failItem(next, String((err && err.message) || err)); })
          .finally(function () { pumpQueue(); });
      }, 0);
    }
  }

  function finishItem(item, result) {
    state.processing--;
    item.status = 'done';
    item.result = result;
    renderItemDone(item);
    updateStat();
    HistoryDB.add({
      name: item.name,
      origSize: item.file.size,
      newSize: result.blob.size,
      format: result.type,
      width: result.width,
      height: result.height,
      time: Date.now()
    }).then(renderHistory).catch(function () {});
  }

  function failItem(item, message) {
    state.processing--;
    item.status = 'error';
    item.error = message;
    renderItemStatus(item);
    updateStat();
  }

  // ---------- 文件接入 ----------
  function addFiles(fileList) {
    var added = false;
    Array.prototype.forEach.call(fileList, function (file) {
      var item = {
        id: state.nextId++,
        file: file,
        name: file.name,
        status: 'pending',
        result: null,
        error: null
      };
      if (!isImageFile(file)) {
        item.status = 'error';
        item.error = '不支持的文件类型（非图片）';
      } else if (file.size === 0) {
        item.status = 'error';
        item.error = '空文件';
      } else {
        state.queue.push(item);
        added = true;
      }
      state.items.push(item);
      renderItem(item);
    });
    if (state.items.length) emptyTip.style.display = 'none';
    updateStat();
    if (added) pumpQueue();
  }

  // ---------- 渲染 ----------
  function renderItem(item) {
    var el = document.createElement('div');
    el.className = 'item';
    el.dataset.id = item.id;

    var thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.textContent = '…';
    el.appendChild(thumb);

    var info = document.createElement('div');
    info.className = 'info';
    var name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.name;
    name.title = item.name;
    info.appendChild(name);
    var meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = formatSize(item.file.size);
    info.appendChild(meta);
    el.appendChild(info);

    var status = document.createElement('div');
    status.className = 'status';
    el.appendChild(status);

    var actions = document.createElement('div');
    actions.className = 'actions';
    el.appendChild(actions);

    item.el = el;
    item.thumbEl = thumb;
    item.metaEl = meta;
    item.statusEl = status;
    item.actionsEl = actions;
    listEl.appendChild(el);
    renderItemStatus(item);
  }

  function renderItemStatus(item) {
    var s = item.statusEl;
    s.className = 'status ' + item.status;
    if (item.status === 'pending') s.textContent = '排队中';
    else if (item.status === 'processing') s.textContent = '处理中…';
    else if (item.status === 'error') s.textContent = '✕ ' + item.error;
  }

  function renderItemDone(item) {
    var r = item.result;
    var url = URL.createObjectURL(r.blob);

    item.thumbEl.textContent = '';
    var img = document.createElement('img');
    img.src = url;
    img.alt = item.name;
    item.thumbEl.appendChild(img);

    var saved = item.file.size - r.blob.size;
    var pct = item.file.size > 0 ? (saved / item.file.size * 100) : 0;
    var cls = saved >= 0 ? 'good' : 'bad';
    var note = r.keptOriginal ? '（已保留原图：压缩后更大）'
      : (r.larger ? '（体积增大，已按目标格式转换）' : '');
    item.metaEl.innerHTML = '';
    item.metaEl.appendChild(document.createTextNode(
      formatSize(item.file.size) + ' → ' + formatSize(r.blob.size) + ' '));
    var badge = document.createElement('span');
    badge.className = 'badge ' + cls;
    badge.textContent = (saved >= 0 ? '-' : '+') + Math.abs(pct).toFixed(1) + '%';
    item.metaEl.appendChild(badge);
    item.metaEl.appendChild(document.createTextNode(
      ' ' + r.width + '×' + r.height + ' ' + extOf(r.type).toUpperCase() + note));

    item.statusEl.textContent = '✓ 完成';
    item.statusEl.className = 'status done';

    var btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = '下载';
    btn.onclick = function () {
      var base = item.name.replace(/\.[^.]+$/, '');
      download(r.blob, base + '.' + extOf(r.type));
    };
    item.actionsEl.appendChild(btn);
    updateDownloadAll();
  }

  function updateStat() {
    var total = state.items.length;
    var done = state.items.filter(function (i) { return i.status === 'done'; }).length;
    var err = state.items.filter(function (i) { return i.status === 'error'; }).length;
    statEl.textContent = total ? ('共 ' + total + ' 张，完成 ' + done + (err ? '，失败 ' + err : '')) : '';
  }

  function updateDownloadAll() {
    var doneItems = state.items.filter(function (i) { return i.status === 'done'; });
    downloadAllBtn.disabled = doneItems.length === 0;
  }

  // ---------- 打包下载 ----------
  async function downloadAll() {
    var doneItems = state.items.filter(function (i) { return i.status === 'done'; });
    if (!doneItems.length) return;
    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = '打包中…';
    try {
      var zip = new ZipWriter();
      var usedNames = {};
      for (var i = 0; i < doneItems.length; i++) {
        var item = doneItems[i];
        var base = item.name.replace(/\.[^.]+$/, '') + '.' + extOf(item.result.type);
        var name = base, n = 1;
        while (usedNames[name]) name = base.replace(/(\.[^.]+)$/, '_' + (n++) + '$1');
        usedNames[name] = true;
        var buf = new Uint8Array(await item.result.blob.arrayBuffer());
        zip.add(name, buf);
      }
      download(zip.generate(), 'compressed-images.zip');
    } finally {
      downloadAllBtn.disabled = false;
      downloadAllBtn.textContent = '打包下载 (ZIP)';
      updateDownloadAll();
    }
  }

  // ---------- 历史 ----------
  function renderHistory() {
    return HistoryDB.getAll().then(function (records) {
      records.sort(function (a, b) { return b.time - a.time; });
      historyList.innerHTML = '';
      records.slice(0, 50).forEach(function (r) {
        var li = document.createElement('li');
        var saved = r.origSize - r.newSize;
        var pct = r.origSize > 0 ? (saved / r.origSize * 100).toFixed(1) : '0.0';
        li.textContent = new Date(r.time).toLocaleString() + ' · ' + r.name +
          ' · ' + formatSize(r.origSize) + ' → ' + formatSize(r.newSize) +
          '（-' + pct + '%）· ' + r.width + '×' + r.height;
        historyList.appendChild(li);
      });
    }).catch(function () {});
  }

  // ---------- 事件 ----------
  dropZone.addEventListener('click', function () { fileInput.click(); });
  dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('dragover'); });
  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files.length) addFiles(fileInput.files);
    fileInput.value = '';
  });

  qualityInput.addEventListener('input', function () { qualityVal.textContent = qualityInput.value; });
  resizeSel.addEventListener('change', function () {
    customSize.style.display = resizeSel.value === 'custom' ? 'inline' : 'none';
  });
  formatSel.addEventListener('change', function () {
    var noQuality = formatSel.value === 'png';
    qualityInput.disabled = noQuality;
    qualityInput.parentElement.classList.toggle('disabled', noQuality);
  });

  downloadAllBtn.addEventListener('click', downloadAll);
  clearBtn.addEventListener('click', function () {
    state.items = [];
    state.queue = [];
    listEl.innerHTML = '';
    emptyTip.style.display = '';
    statEl.textContent = '';
    updateDownloadAll();
  });
  clearHistoryBtn.addEventListener('click', function () {
    HistoryDB.clear().then(renderHistory);
  });

  // ---------- 启动 ----------
  createPool();
  renderHistory();
  updateDownloadAll();
})();
