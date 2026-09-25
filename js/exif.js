/* EXIF 方向解析：从 JPEG 的 ArrayBuffer 中读取 Orientation (1-8)，非 JPEG/无 EXIF 返回 1 */
(function (global) {
  function getOrientation(buffer) {
    var view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1; // 非 JPEG
    var offset = 2;
    while (offset + 4 <= view.byteLength) {
      var marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break;
      var size = view.getUint16(offset + 2);
      if (marker === 0xffe1) { // APP1
        if (view.getUint32(offset + 4) !== 0x45786966) return 1; // "Exif"
        var tiff = offset + 10;
        var littleEndian = view.getUint16(tiff) === 0x4949;
        if (view.getUint16(tiff + 2, littleEndian) !== 0x002a) return 1;
        var ifd = tiff + view.getUint32(tiff + 4, littleEndian);
        var entries = view.getUint16(ifd, littleEndian);
        for (var i = 0; i < entries; i++) {
          var entry = ifd + 2 + i * 12;
          if (entry + 12 > view.byteLength) break;
          if (view.getUint16(entry, littleEndian) === 0x0112) {
            var val = view.getUint16(entry + 8, littleEndian);
            return val >= 1 && val <= 8 ? val : 1;
          }
        }
        return 1;
      }
      offset += 2 + size;
    }
    return 1;
  }

  // 方向 5-8 需要交换宽高
  function isSwapped(orientation) {
    return orientation >= 5 && orientation <= 8;
  }

  // 在 ctx 上应用方向变换（绘制前调用）。width/height 为画布（显示）尺寸，
  // 方向 5-8 时画布宽高已交换，故平移量与经典写法相反。
  function applyOrientation(ctx, orientation, width, height) {
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, width, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, width, height); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, height); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, width, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, width, height); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, height); break;
      default: break;
    }
  }

  global.ExifUtil = { getOrientation: getOrientation, isSwapped: isSwapped, applyOrientation: applyOrientation };
})(typeof self !== 'undefined' ? self : this);
