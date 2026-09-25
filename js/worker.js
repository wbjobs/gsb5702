// 图片处理 Worker：解码（自动纠正 EXIF 方向）→ 缩放 → 编码
'use strict';

self.onmessage = async (event) => {
  const { id, file, options } = event.data;
  try {
    const result = await processImage(file, options);
    const buffer = await result.blob.arrayBuffer();
    self.postMessage({
      id,
      ok: true,
      buffer,
      type: result.blob.type,
      width: result.width,
      height: result.height,
      origWidth: result.origWidth,
      origHeight: result.origHeight,
    }, [buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
  }
};

async function processImage(file, options) {
  const { format, quality, scale, maxDim } = options;

  // imageOrientation: 'from-image' 让浏览器按 EXIF 方向自动旋转/翻转
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    // 部分旧浏览器不支持该选项，退化为默认解码
    bitmap = await createImageBitmap(file);
  }

  const origWidth = bitmap.width;
  const origHeight = bitmap.height;

  let targetW = origWidth;
  let targetH = origHeight;

  if (scale > 0 && scale < 1) {
    targetW = Math.max(1, Math.round(origWidth * scale));
    targetH = Math.max(1, Math.round(origHeight * scale));
  }
  if (maxDim > 0) {
    const longest = Math.max(targetW, targetH);
    if (longest > maxDim) {
      const ratio = maxDim / longest;
      targetW = Math.max(1, Math.round(targetW * ratio));
      targetH = Math.max(1, Math.round(targetH * ratio));
    }
  }

  const outType = format === 'original' ? normalizeType(file.type) : format;

  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');

  // JPEG 不支持透明通道：先铺白底，避免透明区域变黑
  if (outType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  // PNG 为无损格式，quality 参数对其无意义（浏览器会忽略）
  const blob = await canvas.convertToBlob({ type: outType, quality });
  if (!blob || blob.size === 0) {
    throw new Error('编码失败，浏览器可能不支持该输出格式');
  }
  return { blob, width: targetW, height: targetH, origWidth, origHeight };
}

function normalizeType(type) {
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') return type;
  // 其它可解码格式（gif/bmp/avif 等）统一转为 PNG 以保留画质与透明通道
  return 'image/png';
}
