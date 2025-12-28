"use client";

type ImageRecord = {
  id: string;
  original: Blob;
  generated?: Blob;
};

const DB_NAME = "img2coloringbook";
const STORE_NAME = "images";
const DB_VERSION = 1;

const openDatabase = () => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => void
) => {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let request: IDBRequest | null = null;

    try {
      request = callback(store) as unknown as IDBRequest;
    } catch (error) {
      reject(error);
      return;
    }

    transaction.oncomplete = () => {
      if (request) {
        resolve(request.result as T);
      } else {
        resolve(undefined as T);
      }
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const saveImageRecord = async (record: ImageRecord) => {
  return withStore<void>("readwrite", (store) => store.put(record));
};

export const getImageRecord = async (id: string) => {
  return withStore<ImageRecord | undefined>("readonly", (store) =>
    store.get(id)
  );
};

export const deleteImageRecord = async (id: string) => {
  return withStore<void>("readwrite", (store) => store.delete(id));
};

export type { ImageRecord };
