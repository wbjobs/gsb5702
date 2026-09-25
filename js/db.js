// IndexedDB：保存处理历史（元信息 + 缩略图）
'use strict';

const HistoryDB = (() => {
  const DB_NAME = 'image-compressor';
  const DB_VERSION = 1;
  const STORE = 'history';
  const MAX_RECORDS = 100;

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const store = transaction.objectStore(STORE);
      const result = fn(store);
      transaction.oncomplete = () => resolve(result && result._value !== undefined ? result._value : undefined);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function add(record) {
    const db = await open();
    await tx(db, 'readwrite', (store) => {
      store.add(record);
      // 控制历史数量，删除最旧的记录
      const countReq = store.count();
      countReq.onsuccess = () => {
        if (countReq.result > MAX_RECORDS) {
          const cursorReq = store.index('timestamp').openCursor();
          let toDelete = countReq.result - MAX_RECORDS;
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor && toDelete > 0) {
              cursor.delete();
              toDelete--;
              cursor.continue();
            }
          };
        }
      };
    });
  }

  async function getAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const req = transaction.objectStore(STORE).index('timestamp').getAll();
      req.onsuccess = () => resolve((req.result || []).reverse());
      req.onerror = () => reject(req.error);
    });
  }

  async function clear() {
    const db = await open();
    await tx(db, 'readwrite', (store) => store.clear());
  }

  return { add, getAll, clear };
})();
