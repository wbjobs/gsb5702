/* 极简 ZIP 写入器（STORE 不压缩，仅打包），支持 UTF-8 文件名 */
(function (global) {
  var crcTable = null;
  function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    return crcTable;
  }

  function crc32(data) {
    var table = getCrcTable();
    var crc = 0xffffffff;
    for (var i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    var d = date || new Date();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var day = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate());
    return { time: time, day: day };
  }

  function ZipWriter() {
    this.entries = [];
  }

  // name: 文件名, data: Uint8Array
  ZipWriter.prototype.add = function (name, data) {
    this.entries.push({ name: name, data: data, date: new Date() });
  };

  ZipWriter.prototype.generate = function () {
    var encoder = new TextEncoder();
    var parts = [];
    var central = [];
    var offset = 0;

    for (var i = 0; i < this.entries.length; i++) {
      var entry = this.entries[i];
      var nameBytes = encoder.encode(entry.name);
      var crc = crc32(entry.data);
      var dt = dosDateTime(entry.date);

      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);          // version needed
      local.setUint16(6, 0x0800, true);      // UTF-8 flag
      local.setUint16(8, 0, true);           // STORE
      local.setUint16(10, dt.time, true);
      local.setUint16(12, dt.day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, entry.data.length, true);
      local.setUint32(22, entry.data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);

      parts.push(local.buffer, nameBytes, entry.data);

      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dt.time, true);
      cd.setUint16(14, dt.day, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, entry.data.length, true);
      cd.setUint32(24, entry.data.length, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(42, offset, true);
      central.push(cd.buffer, nameBytes);

      offset += 30 + nameBytes.length + entry.data.length;
    }

    var centralSize = 0;
    for (var j = 0; j < central.length; j++) centralSize += central[j].byteLength;

    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);

    return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
  };

  global.ZipWriter = ZipWriter;
})(typeof self !== 'undefined' ? self : this);
