import { AudioProfile } from '../types/editor';
import { createDemoAudioProfile } from './clipTiming';
import { uploadBlobInChunks } from './offlineExporter';

const memoryProfileCache = new Map<string, AudioProfile>();
const inflightRequests = new Map<string, Promise<AudioProfile | null>>();

const DB_NAME = 'shortstudio_audio_profiles_v1';
const STORE_NAME = 'profiles';

function openProfileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'mediaBlobId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function getCachedProfileFromDb(mediaBlobId: string): Promise<AudioProfile | null> {
  try {
    const db = await openProfileDb();
    return await new Promise<AudioProfile | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(mediaBlobId);
      req.onsuccess = () => resolve((req.result as AudioProfile) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveProfileToDb(profile: AudioProfile): Promise<void> {
  try {
    const db = await openProfileDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(profile);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore storage quota errors
  }
}

async function computeProfileInBrowser(
  mediaBlobId: string,
  source: Blob | string,
  numBins = 360
): Promise<AudioProfile | null> {
  try {
    if (source instanceof Blob && source.size > 95 * 1024 * 1024) {
      return null;
    }
    let ab: ArrayBuffer;
    if (typeof source === 'string') {
      const res = await fetch(source);
      if (!res.ok) return null;
      const len = Number(res.headers.get('content-length') || 0);
      if (len > 95 * 1024 * 1024) return null;
      ab = await res.arrayBuffer();
    } else {
      ab = await source.arrayBuffer();
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    try {
      const audioBuf = await ctx.decodeAudioData(ab);
      const ch0 = audioBuf.getChannelData(0);
      const durationSec = audioBuf.duration;
      const sampleRateHz = 20;
      const frameStep = Math.max(1, Math.floor(audioBuf.sampleRate / sampleRateHz));
      const energy20Hz: number[] = [];

      for (let i = 0; i < ch0.length; i += frameStep) {
        const end = Math.min(ch0.length, i + frameStep);
        let sumSq = 0;
        for (let k = i; k < end; k++) sumSq += ch0[k] * ch0[k];
        const rms = Math.sqrt(sumSq / Math.max(1, end - i));
        energy20Hz.push(Math.min(255, Math.round(rms * 255 * 1.45)));
      }

      const peaks: number[] = [];
      for (let b = 0; b < numBins; b++) {
        const s = Math.floor((b / numBins) * ch0.length);
        const e = Math.max(s + 1, Math.floor(((b + 1) / numBins) * ch0.length));
        let maxAbs = 0;
        const step = Math.max(1, Math.floor((e - s) / 120));
        for (let k = s; k < e; k += step) {
          const abs = Math.abs(ch0[k]);
          if (abs > maxAbs) maxAbs = abs;
        }
        peaks.push(Number(Math.min(1, maxAbs).toFixed(3)));
      }

      return { mediaBlobId, durationSec, peaks, energy20Hz, sampleRateHz };
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

export async function getOrExtractAudioProfile(params: {
  mediaBlobId: string | null;
  source: Blob | string | null;
  durationHint?: number;
  isDemo?: boolean;
  numBins?: number;
}): Promise<AudioProfile | null> {
  const { mediaBlobId, source, durationHint = 12, isDemo = false, numBins = 360 } = params;

  if (isDemo) {
    return createDemoAudioProfile(durationHint);
  }

  const cacheKey = mediaBlobId || (typeof source === 'string' ? source : 'standalone');
  const inMem = memoryProfileCache.get(cacheKey);
  if (inMem) return inMem;

  const inflight = inflightRequests.get(cacheKey);
  if (inflight) return inflight;

  const task = (async (): Promise<AudioProfile | null> => {
    if (mediaBlobId) {
      const fromDb = await getCachedProfileFromDb(mediaBlobId);
      if (fromDb && fromDb.peaks?.length > 10) {
        memoryProfileCache.set(cacheKey, fromDb);
        return fromDb;
      }
    }

    // 1. Fast Desktop path: analyze local media file directly on disk by mediaId (zero HTTP upload!)
    if (mediaBlobId && /^[a-zA-Z0-9_-]{4,80}$/.test(mediaBlobId)) {
      try {
        const res = await fetch('/api/audio-peaks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaId: mediaBlobId, numBins }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            durationSec: number;
            peaks: number[];
            energy20Hz: number[];
            sampleRateHz: number;
          };
          if (Array.isArray(data.peaks) && data.peaks.length > 0) {
            const prof: AudioProfile = {
              mediaBlobId,
              durationSec: data.durationSec || durationHint,
              peaks: data.peaks,
              energy20Hz: data.energy20Hz || [],
              sampleRateHz: data.sampleRateHz || 20,
            };
            memoryProfileCache.set(cacheKey, prof);
            await saveProfileToDb(prof);
            return prof;
          }
        }
      } catch {
        // Fall through to media-job upload or browser decode
      }
    }

    if (!source) return null;

    // 2. Web / Standalone file: try lightweight browser AudioContext first if small blob, else media-job
    if (source instanceof Blob && source.size <= 38 * 1024 * 1024) {
      const browserProf = await computeProfileInBrowser(cacheKey, source, numBins);
      if (browserProf) {
        memoryProfileCache.set(cacheKey, browserProf);
        if (mediaBlobId) await saveProfileToDb(browserProf);
        return browserProf;
      }
    }

    // 3. Server FFmpeg PCM peak extraction via media-job (handles large files cleanly on server)
    try {
      let blob: Blob;
      if (source instanceof Blob) {
        blob = source;
      } else {
        const resp = await fetch(source);
        if (!resp.ok) return null;
        blob = await resp.blob();
      }
      const initRes = await fetch('/api/media-job/init', { method: 'POST' });
      if (!initRes.ok) return null;
      const { jobId } = (await initRes.json()) as { jobId: string };
      await uploadBlobInChunks(blob, 'video', jobId);

      const peakRes = await fetch(`/api/media-job/${jobId}/audio-peaks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numBins }),
      });
      if (peakRes.ok) {
        const data = (await peakRes.json()) as {
          durationSec: number;
          peaks: number[];
          energy20Hz: number[];
          sampleRateHz: number;
        };
        if (Array.isArray(data.peaks) && data.peaks.length > 0) {
          const prof: AudioProfile = {
            mediaBlobId: cacheKey,
            durationSec: data.durationSec || durationHint,
            peaks: data.peaks,
            energy20Hz: data.energy20Hz || [],
            sampleRateHz: data.sampleRateHz || 20,
          };
          memoryProfileCache.set(cacheKey, prof);
          if (mediaBlobId) await saveProfileToDb(prof);
          return prof;
        }
      }
    } catch {
      // Fallback for small strings if server unreachable
    }

    return computeProfileInBrowser(cacheKey, source, numBins);
  })();

  inflightRequests.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflightRequests.delete(cacheKey);
  }
}
