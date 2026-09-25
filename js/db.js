/* IndexedDB 处理历史 */
(function (global) {
  var DB_NAME = 'image-compressor';
  var STORE = 'history';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var result = fn(t.objectStore(STORE));
        t.oncomplete = function () { resolve(result && result._value); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  var HistoryDB = {
    add: function (record) {
      return tx('readwrite', function (store) { store.add(record); });
    },
    getAll: function () {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    clear: function () {
      return tx('readwrite', function (store) { store.clear(); });
    }
  };

  global.HistoryDB = HistoryDB;
})(typeof self !== 'undefined' ? self : this);
