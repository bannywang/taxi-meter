const DB_NAME = "TaxiMeterDB";
const STORE_NAME = "routes";
let db;

export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = (e) => console.error("DB Error", e);
    request.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      console.log("IndexedDB Ready");
      resolve(db);
    };
  });
}

export function savePathToDB(id, pathData) {
  if (!db) return;
  const tx = db.transaction([STORE_NAME], "readwrite");
  tx.objectStore(STORE_NAME).add({ id: id, path: pathData });
}

export function getPathFromDB(id) {
  return new Promise((resolve, reject) => {
    if (!db) return reject("DB not ready");
    const tx = db.transaction([STORE_NAME], "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result ? req.result.path : []);
    req.onerror = () => reject("Read Error");
  });
}

export function deleteOldPaths(daysToKeep) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(0);
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;
    const expirationTime = now - daysToKeep * msPerDay;

    let deletedCount = 0;
    const request = store.openCursor();

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.key < expirationTime) {
          cursor.delete();
          deletedCount++;
        }
        cursor.continue();
      } else {
        resolve(deletedCount);
      }
    };
    request.onerror = (e) => {
      console.error("Cleanup failed", e);
      resolve(0);
    };
  });
}
