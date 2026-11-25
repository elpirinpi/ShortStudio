import {
  AppSettings,
  ClipProject,
  DEFAULT_APP_SETTINGS,
  ScheduledPost,
} from '../types/editor';

const DB_NAME = 'kellyclip_studio_v1';
const DB_VERSION = 1;

const STORE_PROJECTS = 'projects';
const STORE_MEDIA = 'mediaBlobs';
const STORE_POSTS = 'scheduledPosts';
const STORE_SETTINGS = 'settings';

export interface StoredMediaBlob {
  id: string;
  blob: Blob;
  name: string;
  mimeType: string;
  createdAt: string;
}

interface RawMediaRecord {
  id: string;
  blob?: Blob;
  buffer?: ArrayBuffer;
  name: string;
  mimeType: string;
  createdAt: string;
}

const memoryMediaStore = new Map<string, StoredMediaBlob>();
const memoryProjectsStore = new Map<string, ClipProject>();
const memoryPostsStore = new Map<string, ScheduledPost>();
let memorySettingsCache: AppSettings | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_POSTS)) {
        db.createObjectStore(STORE_POSTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Error abriendo IndexedDB'));
  });
}

function txPromise<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, mode);
      let settled = false;
      let reqResult: T;
      let hasResult = false;

      tx.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve(reqResult);
        }
      };
      tx.onabort = () => {
        if (!settled) {
          settled = true;
          reject(tx.error ?? new Error('Transacción IndexedDB abortada'));
        }
      };
      tx.onerror = () => {
        if (!settled) {
          settled = true;
          reject(tx.error ?? new Error('Error en transacción IndexedDB'));
        }
      };

      const store = tx.objectStore(storeName);
      const req = op(store);
      req.onsuccess = () => {
        reqResult = req.result;
        hasResult = true;
        if (mode === 'readonly' && !settled) {
          settled = true;
          resolve(reqResult);
        }
      };
      req.onerror = () => {
        if (!settled) {
          settled = true;
          reject(req.error ?? new Error('Error en operación IndexedDB'));
        }
      };
      if (hasResult && mode === 'readonly' && !settled) {
        settled = true;
        resolve(reqResult!);
      }
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function saveMediaBlob(
  id: string,
  blob: Blob,
  name: string
): Promise<void> {
  const mimeType = blob.type || 'video/mp4';
  const createdAt = new Date().toISOString();

  // Always retain in memory first so analysis, editor & export never fail on Electron/Windows IDB Blob errors
  memoryMediaStore.set(id, {
    id,
    blob,
    name,
    mimeType,
    createdAt,
  });

  try {
    const db = await openDb();
    try {
      const record: RawMediaRecord = {
        id,
        blob,
        name,
        mimeType,
        createdAt,
      };
      await txPromise(db, STORE_MEDIA, 'readwrite', (s) => s.put(record));
    } catch {
      // Chromium/Electron on Windows can throw "Internal error." when storing Blob sidecars in IDB;
      // fall back to storing raw ArrayBuffer directly inside the record (up to 250 MB).
      if (blob.size <= 250 * 1024 * 1024) {
        const buffer = await blob.arrayBuffer();
        const fallbackRecord: RawMediaRecord = {
          id,
          buffer,
          name,
          mimeType,
          createdAt,
        };
        await txPromise(db, STORE_MEDIA, 'readwrite', (s) => s.put(fallbackRecord));
      }
    }
  } catch {
    // Graceful fallback: video remains fully usable via memoryMediaStore for the active session
  }
}

export async function getMediaBlob(id: string): Promise<StoredMediaBlob | null> {
  const cached = memoryMediaStore.get(id);
  if (cached) return cached;

  try {
    const db = await openDb();
    const res = await txPromise<RawMediaRecord | undefined>(db, STORE_MEDIA, 'readonly', (s) =>
      s.get(id)
    );
    if (!res) return null;

    const blob =
      res.blob instanceof Blob
        ? res.blob
        : res.buffer
        ? new Blob([res.buffer], { type: res.mimeType || 'video/mp4' })
        : null;

    if (!blob) return null;

    const hydrated: StoredMediaBlob = {
      id: res.id,
      blob,
      name: res.name,
      mimeType: res.mimeType || 'video/mp4',
      createdAt: res.createdAt,
    };
    memoryMediaStore.set(id, hydrated);
    return hydrated;
  } catch {
    return null;
  }
}

export async function deleteMediaBlob(id: string): Promise<void> {
  memoryMediaStore.delete(id);
  try {
    const db = await openDb();
    await txPromise(db, STORE_MEDIA, 'readwrite', (s) => s.delete(id));
  } catch {
    // ignore
  }
}

export async function saveProject(project: ClipProject): Promise<void> {
  memoryProjectsStore.set(project.id, project);
  try {
    const db = await openDb();
    await txPromise(db, STORE_PROJECTS, 'readwrite', (s) => s.put(project));
  } catch {
    // Keep in-memory copy if IndexedDB is unavailable
  }
}

export async function getAllProjects(): Promise<ClipProject[]> {
  try {
    const db = await openDb();
    const items = await txPromise<ClipProject[]>(db, STORE_PROJECTS, 'readonly', (s) =>
      s.getAll()
    );
    for (const item of items ?? []) {
      if (item?.id) memoryProjectsStore.set(item.id, item);
    }
  } catch {
    // Fallback to memoryProjectsStore
  }
  return Array.from(memoryProjectsStore.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function getProjectById(id: string): Promise<ClipProject | null> {
  const mem = memoryProjectsStore.get(id);
  if (mem) return mem;
  try {
    const db = await openDb();
    const res = await txPromise<ClipProject | undefined>(db, STORE_PROJECTS, 'readonly', (s) =>
      s.get(id)
    );
    if (res) memoryProjectsStore.set(res.id, res);
    return res ?? null;
  } catch {
    return null;
  }
}

export async function deleteProject(id: string): Promise<void> {
  const existing = await getProjectById(id);
  memoryProjectsStore.delete(id);
  try {
    const db = await openDb();
    await txPromise(db, STORE_PROJECTS, 'readwrite', (s) => s.delete(id));
  } catch {
    // ignore
  }
  if (existing?.mediaBlobId) {
    await deleteMediaBlob(existing.mediaBlobId);
  }
  const posts = await getAllScheduledPosts();
  for (const post of posts) {
    if (post.projectId === id) {
      await deleteScheduledPost(post.id);
    }
  }
}

export async function saveScheduledPost(post: ScheduledPost): Promise<void> {
  memoryPostsStore.set(post.id, post);
  try {
    const db = await openDb();
    await txPromise(db, STORE_POSTS, 'readwrite', (s) => s.put(post));
  } catch {
    // ignore
  }
}

export async function getAllScheduledPosts(): Promise<ScheduledPost[]> {
  try {
    const db = await openDb();
    const items = await txPromise<ScheduledPost[]>(db, STORE_POSTS, 'readonly', (s) =>
      s.getAll()
    );
    for (const item of items ?? []) {
      if (item?.id) memoryPostsStore.set(item.id, item);
    }
  } catch {
    // fallback to memoryPostsStore
  }
  return Array.from(memoryPostsStore.values()).sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );
}

export async function deleteScheduledPost(id: string): Promise<void> {
  memoryPostsStore.delete(id);
  try {
    const db = await openDb();
    await txPromise(db, STORE_POSTS, 'readwrite', (s) => s.delete(id));
  } catch {
    // ignore
  }
}

export async function getAppSettings(): Promise<AppSettings> {
  try {
    const db = await openDb();
    const res = await txPromise<{ id: string; value: AppSettings } | undefined>(
      db,
      STORE_SETTINGS,
      'readonly',
      (s) => s.get('app_settings')
    );
    const merged = res?.value ? { ...DEFAULT_APP_SETTINGS, ...res.value } : DEFAULT_APP_SETTINGS;
    memorySettingsCache = merged;
    return merged;
  } catch {
    return memorySettingsCache ?? DEFAULT_APP_SETTINGS;
  }
}

export async function saveAppSettings(value: AppSettings): Promise<void> {
  memorySettingsCache = value;
  try {
    const db = await openDb();
    await txPromise(db, STORE_SETTINGS, 'readwrite', (s) =>
      s.put({ id: 'app_settings', value })
    );
  } catch {
    // ignore
  }
}

export async function clearAllStudioData(): Promise<void> {
  memoryMediaStore.clear();
  memoryProjectsStore.clear();
  memoryPostsStore.clear();
  try {
    const db = await openDb();
    await Promise.all([
      txPromise(db, STORE_PROJECTS, 'readwrite', (s) => s.clear()),
      txPromise(db, STORE_MEDIA, 'readwrite', (s) => s.clear()),
      txPromise(db, STORE_POSTS, 'readwrite', (s) => s.clear()),
    ]);
  } catch {
    // ignore
  }
}

export async function getStorageEstimate(): Promise<{
  usedMB: number;
  quotaMB: number;
} | null> {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    return {
      usedMB: Number(((est.usage || 0) / (1024 * 1024)).toFixed(1)),
      quotaMB: Number(((est.quota || 0) / (1024 * 1024)).toFixed(0)),
    };
  } catch {
    return null;
  }
}
