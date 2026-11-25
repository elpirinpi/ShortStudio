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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = op(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Error en transacción IndexedDB'));
  });
}

export async function saveMediaBlob(
  id: string,
  blob: Blob,
  name: string
): Promise<void> {
  const db = await openDb();
  const record: StoredMediaBlob = {
    id,
    blob,
    name,
    mimeType: blob.type || 'video/mp4',
    createdAt: new Date().toISOString(),
  };
  await txPromise(db, STORE_MEDIA, 'readwrite', (s) => s.put(record));
}

export async function getMediaBlob(id: string): Promise<StoredMediaBlob | null> {
  const db = await openDb();
  const res = await txPromise<StoredMediaBlob | undefined>(db, STORE_MEDIA, 'readonly', (s) =>
    s.get(id)
  );
  return res ?? null;
}

export async function deleteMediaBlob(id: string): Promise<void> {
  const db = await openDb();
  await txPromise(db, STORE_MEDIA, 'readwrite', (s) => s.delete(id));
}

export async function saveProject(project: ClipProject): Promise<void> {
  const db = await openDb();
  await txPromise(db, STORE_PROJECTS, 'readwrite', (s) => s.put(project));
}

export async function getAllProjects(): Promise<ClipProject[]> {
  const db = await openDb();
  const items = await txPromise<ClipProject[]>(db, STORE_PROJECTS, 'readonly', (s) =>
    s.getAll()
  );
  return (items ?? []).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function getProjectById(id: string): Promise<ClipProject | null> {
  const db = await openDb();
  const res = await txPromise<ClipProject | undefined>(db, STORE_PROJECTS, 'readonly', (s) =>
    s.get(id)
  );
  return res ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const existing = await getProjectById(id);
  await txPromise(db, STORE_PROJECTS, 'readwrite', (s) => s.delete(id));
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
  const db = await openDb();
  await txPromise(db, STORE_POSTS, 'readwrite', (s) => s.put(post));
}

export async function getAllScheduledPosts(): Promise<ScheduledPost[]> {
  const db = await openDb();
  const items = await txPromise<ScheduledPost[]>(db, STORE_POSTS, 'readonly', (s) =>
    s.getAll()
  );
  return (items ?? []).sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );
}

export async function deleteScheduledPost(id: string): Promise<void> {
  const db = await openDb();
  await txPromise(db, STORE_POSTS, 'readwrite', (s) => s.delete(id));
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
    return res?.value ? { ...DEFAULT_APP_SETTINGS, ...res.value } : DEFAULT_APP_SETTINGS;
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export async function saveAppSettings(value: AppSettings): Promise<void> {
  const db = await openDb();
  await txPromise(db, STORE_SETTINGS, 'readwrite', (s) =>
    s.put({ id: 'app_settings', value })
  );
}

export async function clearAllStudioData(): Promise<void> {
  const db = await openDb();
  await Promise.all([
    txPromise(db, STORE_PROJECTS, 'readwrite', (s) => s.clear()),
    txPromise(db, STORE_MEDIA, 'readwrite', (s) => s.clear()),
    txPromise(db, STORE_POSTS, 'readwrite', (s) => s.clear()),
  ]);
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
