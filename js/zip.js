// 极简 ZIP 打包器（STORE 模式，无压缩）：图片已压缩，再压缩收益极低
'use strict';

const ZipBuilder = (() => {
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
    const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
    return { time, day };
  }

  class Builder {
    constructor() {
      this.entries = [];
    }

    // name: 压缩包内文件名; data: Blob | ArrayBuffer | Uint8Array
    async add(name, data) {
      let bytes;
      if (data instanceof Uint8Array) {
        bytes = data;
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else if (data instanceof Blob) {
        bytes = new Uint8Array(await data.arrayBuffer());
      } else {
        throw new Error('不支持的 ZIP 数据类型');
      }
      this.entries.push({ name, bytes, crc: crc32(bytes), date: new Date() });
    }

    build() {
      const encoder = new TextEncoder();
      const parts = [];
      const central = [];
      let offset = 0;

      for (const entry of this.entries) {
        const nameBytes = encoder.encode(entry.name);
        const { time, day } = dosDateTime(entry.date);

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);          // version needed
        local.setUint16(6, 0x0800, true);      // UTF-8 文件名标志
        local.setUint16(8, 0, true);           // STORE
        local.setUint16(10, time, true);
        local.setUint16(12, day, true);
        local.setUint32(14, entry.crc, true);
        local.setUint32(18, entry.bytes.length, true);
        local.setUint32(22, entry.bytes.length, true);
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);

        parts.push(local.buffer, nameBytes, entry.bytes);

        const cen = new DataView(new ArrayBuffer(46));
        cen.setUint32(0, 0x02014b50, true);
        cen.setUint16(4, 20, true);
        cen.setUint16(6, 20, true);
        cen.setUint16(8, 0x0800, true);
        cen.setUint16(10, 0, true);
        cen.setUint16(12, time, true);
        cen.setUint16(14, day, true);
        cen.setUint32(16, entry.crc, true);
        cen.setUint32(20, entry.bytes.length, true);
        cen.setUint32(24, entry.bytes.length, true);
        cen.setUint16(28, nameBytes.length, true);
        cen.setUint32(42, offset, true);
        central.push(cen.buffer, nameBytes);

        offset += 30 + nameBytes.length + entry.bytes.length;
      }

      const centralSize = central.reduce((sum, p) => sum + (p.byteLength || p.length), 0);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, this.entries.length, true);
      end.setUint16(10, this.entries.length, true);
      end.setUint32(12, centralSize, true);
      end.setUint32(16, offset, true);

      return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
    }
  }

  return { Builder };
})();
