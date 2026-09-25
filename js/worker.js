/* 压缩 Worker：OffscreenCanvas 处理，主线程零阻塞 */
importScripts('exif.js');

var MAX_CANVAS_DIM = 16000; // 画布安全上限

self.onmessage = function (e) {
  var data = e.data;
  processImage(data.file, data.options)
    .then(function (result) {
      self.postMessage({ id: data.id, ok: true, result: result });
    })
    .catch(function (err) {
      self.postMessage({ id: data.id, ok: false, error: String((err && err.message) || err) });
    });
};

function resolveTargetType(fileType, toFormat) {
  if (toFormat !== 'original') return 'image/' + toFormat;
  if (fileType === 'image/jpeg' || fileType === 'image/png' || fileType === 'image/webp') return fileType;
  return 'image/png'; // 其它格式（gif 格式保持时）统一转 PNG 以保留透明
}

function computeSize(srcW, srcH, options) {
  var w = srcW, h = srcH;
  if (options.maxWidth > 0 && w > options.maxWidth) {
    h = Math.round(h * options.maxWidth / w);
    w = options.maxWidth;
  }
  if (options.maxHeight > 0 && h > options.maxHeight) {
    w = Math.round(w * options.maxHeight / h);
    h = options.maxHeight;
  }
  // 超大图保护：限制在画布安全范围内
  var biggest = Math.max(w, h);
  if (biggest > MAX_CANVAS_DIM) {
    var ratio = MAX_CANVAS_DIM / biggest;
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  return { width: Math.max(1, w), height: Math.max(1, h) };
}

async function decodeAutoOrient(file) {
  // 优先使用浏览器内建 EXIF 方向纠正
  try {
    return { bitmap: await createImageBitmap(file, { imageOrientation: 'from-image' }), orientation: 1 };
  } catch (err) {
    // 兜底：手动解析 EXIF 并自行变换
    var buf = await file.arrayBuffer();
    var orientation = ExifUtil.getOrientation(buf);
    var bitmap = await createImageBitmap(file);
    return { bitmap: bitmap, orientation: orientation };
  }
}

async function processImage(file, options) {
  var targetType = resolveTargetType(file.type, options.format);
  var decoded = await decodeAutoOrient(file);
  var bitmap = decoded.bitmap;
  var orientation = decoded.orientation;

  var srcW = bitmap.width, srcH = bitmap.height;
  var swapped = ExifUtil.isSwapped(orientation);
  var size = computeSize(swapped ? srcH : srcW, swapped ? srcW : srcH, options);

  var canvas = new OffscreenCanvas(size.width, size.height);
  var ctx = canvas.getContext('2d');

  // JPEG 无透明通道：先铺白底，避免透明区域变黑
  if (targetType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
  }

  ctx.save();
  // 手动 EXIF 变换时，按交换后的画布坐标系应用矩阵
  ExifUtil.applyOrientation(ctx, orientation, size.width, size.height);
  if (swapped) {
    ctx.drawImage(bitmap, 0, 0, size.height, size.width);
  } else {
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  }
  ctx.restore();
  bitmap.close();

  var blob;
  if (targetType === 'image/png') {
    blob = await canvas.convertToBlob({ type: targetType }); // PNG 无损，quality 无意义
  } else {
    blob = await canvas.convertToBlob({ type: targetType, quality: options.quality });
  }

  // 压缩后反而变大：同格式时回退为原文件，保证"只小不大"
  var keptOriginal = false;
  if (blob.size >= file.size && targetType === file.type) {
    blob = file;
    keptOriginal = true;
  }

  return {
    blob: blob,
    width: size.width,
    height: size.height,
    type: targetType,
    keptOriginal: keptOriginal,
    larger: !keptOriginal && blob.size > file.size
  };
}
