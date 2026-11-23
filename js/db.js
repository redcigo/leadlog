/**
 * Local storage on the device, using IndexedDB.
 * Nothing in this module talks to a network.
 */

const DB_NAME = 'leadlog';
const DB_VERSION = 2;

/** @type {Promise<IDBDatabase> | null} */
let opening = null;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore('shows', { keyPath: 'id' });
        const leads = db.createObjectStore('leads', { keyPath: 'id' });
        leads.createIndex('showId', 'showId');
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      // Version 2: the organiser's lead list for a show, used to match badge codes.
      if (event.oldVersion < 2) db.createObjectStore('rosters', { keyPath: 'showId' });
    };
    request.onsuccess = () => {
      const db = request.result;
      // If a newer version of the app opens the database in another tab, step aside.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database upgrade blocked by another open tab.'));
  });
  return opening;
}

/** Wrap an IDBRequest in a promise. */
function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run fn inside a transaction and resolve when the transaction commits. */
async function transact(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    Promise.resolve(fn(tx)).then((r) => { result = r; }, (err) => { tx.abort(); reject(err); });
  });
}

export async function getAll(store) {
  return transact(store, 'readonly', (tx) => done(tx.objectStore(store).getAll()));
}

export async function get(store, key) {
  return transact(store, 'readonly', (tx) => done(tx.objectStore(store).get(key)));
}

export async function getByIndex(store, index, value) {
  return transact(store, 'readonly', (tx) => done(tx.objectStore(store).index(index).getAll(value)));
}

export async function put(store, value) {
  return transact(store, 'readwrite', (tx) => done(tx.objectStore(store).put(value)));
}

export async function remove(store, key) {
  return transact(store, 'readwrite', (tx) => done(tx.objectStore(store).delete(key)));
}

/** Write many records across stores in one transaction. items: [{store, value}] */
export async function putMany(items) {
  const stores = [...new Set(items.map((i) => i.store))];
  if (!stores.length) return;
  return transact(stores, 'readwrite', (tx) => {
    for (const { store, value } of items) tx.objectStore(store).put(value);
  });
}

/** Delete a show together with its leads, photos, logo and organiser list. */
export async function removeShow(showId) {
  return transact(['shows', 'leads', 'photos', 'rosters'], 'readwrite', async (tx) => {
    const show = await done(tx.objectStore('shows').get(showId));
    const leads = await done(tx.objectStore('leads').index('showId').getAll(showId));
    for (const lead of leads) {
      if (lead.photoId) tx.objectStore('photos').delete(lead.photoId);
      tx.objectStore('leads').delete(lead.id);
    }
    if (show && show.logoId) tx.objectStore('photos').delete(show.logoId);
    tx.objectStore('rosters').delete(showId);
    tx.objectStore('shows').delete(showId);
  });
}

export async function getSetting(key, fallback) {
  const row = await get('settings', key);
  return row === undefined ? fallback : row.value;
}

export async function setSetting(key, value) {
  return put('settings', { key, value });
}

/** Ask the browser not to clear this app's data under storage pressure. */
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted() {
  try {
    return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  } catch {
    return false;
  }
}

/** Create a short random id. */
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
