  // ===========================================================================
  // INDEXEDDB STORAGE
  // ===========================================================================

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(FILE_STORE)) {
          const store = database.createObjectStore(FILE_STORE, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: true });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!database.objectStoreNames.contains(ASSET_STORE)) database.createObjectStore(ASSET_STORE, { keyPath: 'id' });
        if (!database.objectStoreNames.contains(SAFETY_STORE)) database.createObjectStore(SAFETY_STORE, { keyPath: 'id' });
        if (!database.objectStoreNames.contains(TRASH_STORE)) database.createObjectStore(TRASH_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGetAll() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, 'readonly');
      const req = tx.objectStore(FILE_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGet(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, 'readonly');
      const req = tx.objectStore(FILE_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function idbPut(file) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, 'readwrite');
      const req = tx.objectStore(FILE_STORE).put(file);
      req.onsuccess = () => resolve(file);
      req.onerror = () => reject(req.error);
    });
  }

  function idbDelete(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, 'readwrite');
      const req = tx.objectStore(FILE_STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function idbClear() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, 'readwrite');
      const req = tx.objectStore(FILE_STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  function storeGetAll(storeName){return new Promise((resolve,reject)=>{const r=db.transaction(storeName,'readonly').objectStore(storeName).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
  function storeGet(storeName,id){return new Promise((resolve,reject)=>{const r=db.transaction(storeName,'readonly').objectStore(storeName).get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}
  function storePut(storeName,value){return new Promise((resolve,reject)=>{const r=db.transaction(storeName,'readwrite').objectStore(storeName).put(value);r.onsuccess=()=>resolve(value);r.onerror=()=>reject(r.error);});}
  function storeClear(storeName){return new Promise((resolve,reject)=>{const r=db.transaction(storeName,'readwrite').objectStore(storeName).clear();r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
  function storeDelete(storeName,id){return new Promise((resolve,reject)=>{const r=db.transaction(storeName,'readwrite').objectStore(storeName).delete(id);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
