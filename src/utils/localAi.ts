import {
  AiEngineMode,
  ClipProject,
  DEFAULT_SETTINGS,
  DEFAULT_SUBTITLES,
  EditorSettings,
  FaceKeyframe,
  GeneratedClip,
  getPresetPatch,
  ProjectConfig,
  SignalBreakdown,
  SubtitleCue,
  TranscriptSegment,
  TranscriptWord,
  WhisperModelId,
} from '../types/editor';
import { createDemoFaceKeyframes, trackFacesInVideo } from './faceTracker';

export interface VideoMetadataResult {
  duration: number;
  width: number;
  height: number;
  thumbnailDataUrl: string | null;
}

export async function extractVideoMetadataAndThumbnail(
  blob: Blob
): Promise<VideoMetadataResult> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Tiempo agotado leyendo video')), 12000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('No se pudo leer el archivo de video'));
      };
    });

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
    const width = video.videoWidth || 1080;
    const height = video.videoHeight || 1920;

    // Seek for thumbnail
    const targetSeek = Math.min(Math.max(0.2, duration * 0.12), Math.max(0.2, duration - 0.1));
    video.currentTime = targetSeek;
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 1500);
      video.onseeked = () => {
        window.clearTimeout(timer);
        resolve();
      };
    });

    let thumbnailDataUrl: string | null = null;
    try {
      const thumbCanvas = document.createElement('canvas');
      const maxDim = 420;
      const scale = Math.min(maxDim / width, maxDim / height, 1);
      thumbCanvas.width = Math.max(120, Math.round(width * scale));
      thumbCanvas.height = Math.max(120, Math.round(height * scale));
      const ctx = thumbCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
        thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);
      }
    } catch {
      thumbnailDataUrl = null;
    }

    return { duration, width, height, thumbnailDataUrl };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function extractMonoAudio16k(blob: Blob): Promise<Float32Array | null> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const tempCtx = new AudioCtx();

    let decoded: AudioBuffer;
    try {
      decoded = await tempCtx.decodeAudioData(arrayBuffer);
    } finally {
      await tempCtx.close().catch(() => {});
    }

    const targetRate = 16000;
    const length16k = Math.max(1, Math.ceil(decoded.duration * targetRate));
    const offline = new OfflineAudioContext(1, length16k, targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } catch {
    return null;
  }
}

interface AcousticAnalysis {
  rmsBins: number[]; // 0.25s per bin
  binDuration: number;
  noiseFloor: number;
  peakRms: number;
  speechSegments: TranscriptSegment[];
}

function analyzeAcousticEnvelope(
  pcm16k: Float32Array | null,
  duration: number
): AcousticAnalysis {
  const binDuration = 0.25;
  const totalBins = Math.max(4, Math.ceil(duration / binDuration));

  if (!pcm16k || pcm16k.length === 0) {
    const fallbackBins = new Array<number>(totalBins).fill(0.05);
    return {
      rmsBins: fallbackBins,
      binDuration,
      noiseFloor: 0.02,
      peakRms: 0.05,
      speechSegments: buildEvenPlaceholderSegments(duration),
    };
  }

  const samplesPerBin = Math.floor(16000 * binDuration);
  const rmsBins: number[] = [];
  for (let i = 0; i < totalBins; i++) {
    const start = i * samplesPerBin;
    const end = Math.min(pcm16k.length, start + samplesPerBin);
    if (start >= end) {
      rmsBins.push(0);
      continue;
    }
    let sumSq = 0;
    for (let j = start; j < end; j++) {
      const s = pcm16k[j];
      sumSq += s * s;
    }
    rmsBins.push(Math.sqrt(sumSq / (end - start)));
  }

  const sorted = [...rmsBins].sort((a, b) => a - b);
  const p20 = sorted[Math.floor(sorted.length * 0.2)] || 0.005;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0.1;
  const noiseFloor = Math.max(0.004, p20 * 1.45);
  const peakRms = Math.max(0.02, p95);

  // Extract contiguous voice-activity segments
  const speechSegments: TranscriptSegment[] = [];
  let segStart: number | null = null;
  let silentCount = 0;

  for (let i = 0; i < rmsBins.length; i++) {
    const isVoice = rmsBins[i] > noiseFloor;
    const t = i * binDuration;
    if (isVoice) {
      if (segStart === null) segStart = t;
      silentCount = 0;
    } else if (segStart !== null) {
      silentCount++;
      if (silentCount >= 2 || t - segStart >= 4.5) {
        const end = Math.min(duration, t);
        if (end - segStart >= 0.6) {
          speechSegments.push({
            start: Number(segStart.toFixed(2)),
            end: Number(end.toFixed(2)),
            text: `Segmento de voz ${speechSegments.length + 1}`,
          });
        }
        segStart = null;
        silentCount = 0;
      }
    }
  }
  if (segStart !== null) {
    const end = Number(duration.toFixed(2));
    if (end - segStart >= 0.5) {
      speechSegments.push({
        start: Number(segStart.toFixed(2)),
        end,
        text: `Segmento de voz ${speechSegments.length + 1}`,
      });
    }
  }

  return {
    rmsBins,
    binDuration,
    noiseFloor,
    peakRms,
    speechSegments: speechSegments.length > 0 ? speechSegments : buildEvenPlaceholderSegments(duration),
  };
}

function buildEvenPlaceholderSegments(duration: number): TranscriptSegment[] {
  const segs: TranscriptSegment[] = [];
  const step = 3;
  for (let t = 0; t < duration; t += step) {
    const end = Math.min(duration, t + step - 0.1);
    if (end - t >= 0.5) {
      segs.push({
        start: Number(t.toFixed(2)),
        end: Number(end.toFixed(2)),
        text: `Bloque ${segs.length + 1}`,
      });
    }
  }
  return segs;
}

async function sampleVisualDynamics(blob: Blob, duration: number): Promise<number[]> {
  const sampleCount = Math.min(24, Math.max(6, Math.floor(duration / 2)));
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 27;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const diffs: number[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error('timeout')), 6000);
      video.onloadeddata = () => {
        window.clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(t);
        reject(new Error('error'));
      };
    });

    let prevFrame: Uint8ClampedArray | null = null;
    for (let i = 0; i < sampleCount; i++) {
      const target = (i / Math.max(1, sampleCount - 1)) * Math.max(0.2, duration - 0.2);
      video.currentTime = target;
      await new Promise<void>((res) => {
        const tm = window.setTimeout(res, 500);
        video.onseeked = () => {
          window.clearTimeout(tm);
          res();
        };
      });

      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        if (prevFrame) {
          let diffSum = 0;
          for (let p = 0; p < data.length; p += 4) {
            diffSum +=
              Math.abs(data[p] - prevFrame[p]) +
              Math.abs(data[p + 1] - prevFrame[p + 1]) +
              Math.abs(data[p + 2] - prevFrame[p + 2]);
          }
          const avgDiff = diffSum / ((data.length / 4) * 3 * 255);
          diffs.push(Math.min(1, avgDiff * 4.5));
        }
        prevFrame = new Uint8ClampedArray(data);
      }
    }
  } catch {
    // Graceful fallback when browser blocks frame decoding
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }

  return diffs.length > 0 ? diffs : [0.55];
}

async function runWhisperWorker(
  pcm16k: Float32Array,
  modelId: WhisperModelId,
  language: string,
  onProgress: (pct: number, label: string) => void
): Promise<TranscriptSegment[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), {
      type: 'module',
    });

    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Tiempo de espera agotado en transcripción local'));
    }, 180_000);

    worker.onmessage = (
      e: MessageEvent<{
        type: 'status' | 'progress' | 'result' | 'error';
        message?: string;
        progress?: number;
        text?: string;
        chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
      }>
    ) => {
      const msg = e.data;
      if (msg.type === 'status' && msg.message) {
        onProgress(45, msg.message);
      } else if (msg.type === 'progress' && typeof msg.progress === 'number') {
        const mapped = 35 + Math.round((msg.progress / 100) * 35);
        onProgress(mapped, msg.message || `Cargando Whisper (${msg.progress}%)...`);
      } else if (msg.type === 'result') {
        window.clearTimeout(timeout);
        worker.terminate();
        const audioDuration = Math.max(1, pcm16k.length / 16000);
        const segments = groupWhisperChunksIntoSegments(msg.chunks || [], msg.text || '', audioDuration);
        resolve(segments);
      } else if (msg.type === 'error') {
        window.clearTimeout(timeout);
        worker.terminate();
        reject(new Error(msg.message || 'Error en Whisper local'));
      }
    };

    worker.onerror = (err) => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(err.message || 'Error iniciando Web Worker'));
    };

    const copy = new Float32Array(pcm16k);
    worker.postMessage({ type: 'transcribe', audio: copy, modelId, language }, [copy.buffer]);
  });
}

function groupWhisperChunksIntoSegments(
  chunks: Array<{ timestamp: [number, number | null]; text: string }>,
  fullText: string,
  totalDuration = 10
): TranscriptSegment[] {
  const cleanWords: TranscriptWord[] = [];

  for (let idx = 0; idx < chunks.length; idx++) {
    const ch = chunks[idx];
    const text = (ch.text || '').trim();
    if (!text) continue;

    const start = Math.max(0, ch.timestamp?.[0] ?? 0);
    const nextStart = chunks[idx + 1]?.timestamp?.[0];
    const rawEnd = ch.timestamp?.[1];
    const end =
      typeof rawEnd === 'number' && rawEnd > start
        ? rawEnd
        : typeof nextStart === 'number' && nextStart > start
        ? nextStart
        : Math.min(totalDuration, start + Math.max(0.4, text.split(/\s+/).length * 0.36));

    const subTokens = text.split(/\s+/).filter(Boolean);
    if (subTokens.length === 1) {
      cleanWords.push({ start, end, text: subTokens[0] });
    } else {
      // Phrase chunk from return_timestamps: true -> distribute proportionally across words
      const span = Math.max(0.2, end - start);
      const weights = subTokens.map((t) => t.length + 2);
      const totalW = weights.reduce((a, b) => a + b, 0);
      let cursor = start;
      subTokens.forEach((tk, i) => {
        const wDur = (weights[i] / totalW) * span;
        cleanWords.push({
          start: Number(cursor.toFixed(2)),
          end: Number((cursor + wDur).toFixed(2)),
          text: tk,
        });
        cursor += wDur;
      });
    }
  }

  if (cleanWords.length === 0 && fullText.trim()) {
    const tokens = fullText.trim().split(/\s+/).filter(Boolean);
    const step = Math.max(0.25, totalDuration / Math.max(1, tokens.length));
    tokens.forEach((tk, i) => {
      cleanWords.push({
        start: Number((i * step).toFixed(2)),
        end: Number(((i + 1) * step).toFixed(2)),
        text: tk,
      });
    });
  }

  // Group into natural sentence/phrase segments (~6-10 words or pause > 0.7s)
  const segments: TranscriptSegment[] = [];
  let buf: TranscriptWord[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    segments.push({
      start: Number(buf[0].start.toFixed(2)),
      end: Number(buf[buf.length - 1].end.toFixed(2)),
      text: buf.map((w) => w.text).join(' '),
      words: [...buf],
    });
    buf = [];
  };

  for (let i = 0; i < cleanWords.length; i++) {
    const w = cleanWords[i];
    const prev = buf[buf.length - 1];
    const gap = prev ? w.start - prev.end : 0;
    const endsSentence = prev ? /[.!?]$/.test(prev.text) : false;

    if (buf.length >= 10 || gap > 0.75 || endsSentence) {
      flush();
    }
    buf.push(w);
  }
  flush();

  return segments;
}

const STOPWORDS = new Set([
  'para', 'como', 'pero', 'porque', 'cuando', 'donde', 'quien', 'este', 'esta', 'esto',
  'estos', 'estas', 'sobre', 'entre', 'desde', 'hasta', 'todo', 'toda', 'todos', 'todas',
  'tiene', 'tienen', 'hacer', 'puede', 'pueden', 'algo', 'mucho', 'muy', 'bien', 'mas',
  'the', 'and', 'for', 'that', 'this', 'with', 'you', 'your', 'from', 'have', 'are', 'was',
]);

function extractKeywords(text: string): string[] {
  const counts = new Map<string, number>();
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

  for (const w of words) {
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([w]) => w);
}

function emphasizeViralWord(words: string[]): string {
  if (words.length === 0) return '';
  if (words.some((w) => w.includes('*'))) return words.join(' ');
  // Pick the strongest non-stopword (longest >= 5 chars) to emphasize with *word*
  let bestIdx = -1;
  let bestLen = 4;
  words.forEach((w, idx) => {
    const clean = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (clean.length > bestLen && !STOPWORDS.has(clean)) {
      bestLen = clean.length;
      bestIdx = idx;
    }
  });
  return words
    .map((w, idx) => (idx === bestIdx ? `*${w}*` : w))
    .join(' ');
}

export function transcriptToSubtitles(
  transcript: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
  wordsPerBlock = 3
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const wordsInClip: TranscriptWord[] = [];

  for (const seg of transcript) {
    if (seg.end < clipStart || seg.start > clipEnd) continue;
    if (seg.words && seg.words.length > 0) {
      for (const w of seg.words) {
        if (w.end >= clipStart && w.start <= clipEnd) {
          wordsInClip.push(w);
        }
      }
    } else {
      const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
      const segDur = Math.max(0.2, seg.end - seg.start);
      const step = segDur / Math.max(1, tokens.length);
      tokens.forEach((tk, idx) => {
        const ws = seg.start + idx * step;
        const we = ws + step;
        if (we >= clipStart && ws <= clipEnd) {
          wordsInClip.push({ start: ws, end: we, text: tk });
        }
      });
    }
  }

  const blockSize = Math.max(1, Math.min(8, wordsPerBlock));
  for (let i = 0; i < wordsInClip.length; i += blockSize) {
    const slice = wordsInClip.slice(i, i + blockSize);
    const start = Number(Math.max(clipStart, slice[0].start).toFixed(2));
    const end = Number(
      Math.min(clipEnd, Math.max(start + 0.35, slice[slice.length - 1].end)).toFixed(2)
    );
    cues.push({
      id: Date.now() + cues.length + i,
      start,
      end,
      text: emphasizeViralWord(slice.map((w) => w.text)),
    });
  }

  return cues;
}

export async function transcribeVideoRange(params: {
  source: Blob | string;
  start?: number;
  end?: number;
  language: string;
  modelId: WhisperModelId;
  wordsPerBlock?: number;
  onProgress?: (pct: number, label: string) => void;
}): Promise<{
  transcript: TranscriptSegment[];
  subtitles: SubtitleCue[];
  engineUsed: string;
}> {
  const {
    source,
    start = 0,
    end,
    language,
    modelId,
    wordsPerBlock = 3,
    onProgress,
  } = params;

  onProgress?.(8, 'Extrayendo pista de audio (16kHz)...');
  let blob: Blob;
  if (typeof source === 'string') {
    const res = await fetch(source);
    blob = await res.blob();
  } else {
    blob = source;
  }

  const pcm16k = await extractMonoAudio16k(blob);
  const fullDuration = pcm16k ? pcm16k.length / 16000 : end || 12;
  const clipStart = Math.max(0, start);
  const clipEnd = Math.min(fullDuration, end ?? fullDuration);

  if (!pcm16k || pcm16k.length === 0) {
    const fallbackSegs = buildEvenPlaceholderSegments(Math.max(1, clipEnd - clipStart)).map(
      (s) => ({
        ...s,
        start: Number((s.start + clipStart).toFixed(2)),
        end: Number((s.end + clipStart).toFixed(2)),
      })
    );
    return {
      transcript: fallbackSegs,
      subtitles: transcriptToSubtitles(fallbackSegs, clipStart, clipEnd, wordsPerBlock),
      engineUsed: 'Sin pista de audio (Segmentos base)',
    };
  }

  const startSample = Math.max(0, Math.floor(clipStart * 16000));
  const endSample = Math.min(pcm16k.length, Math.ceil(clipEnd * 16000));
  const slicePcm =
    startSample > 0 || endSample < pcm16k.length
      ? pcm16k.slice(startSample, Math.max(startSample + 1600, endSample))
      : pcm16k;

  try {
    onProgress?.(25, 'Cargando Whisper local en Web Worker...');
    const rawSegs = await runWhisperWorker(
      slicePcm,
      modelId,
      language,
      (pct, msg) => onProgress?.(pct, msg)
    );

    const shiftedSegs: TranscriptSegment[] = rawSegs.map((seg) => ({
      ...seg,
      start: Number((seg.start + clipStart).toFixed(2)),
      end: Number((seg.end + clipStart).toFixed(2)),
      words: seg.words?.map((w) => ({
        ...w,
        start: Number((w.start + clipStart).toFixed(2)),
        end: Number((w.end + clipStart).toFixed(2)),
      })),
    }));

    const cues = transcriptToSubtitles(shiftedSegs, clipStart, clipEnd, wordsPerBlock);
    onProgress?.(100, 'Transcripción completada.');

    return {
      transcript: shiftedSegs,
      subtitles: cues,
      engineUsed: `Whisper Local (${modelId.replace('Xenova/', '')} · Gratis)`,
    };
  } catch {
    onProgress?.(75, 'Generando bloques por actividad vocal (respaldo offline)...');
    const acoustic = analyzeAcousticEnvelope(slicePcm, Math.max(1, clipEnd - clipStart));
    const shiftedSegs = acoustic.speechSegments.map((seg) => ({
      ...seg,
      start: Number((seg.start + clipStart).toFixed(2)),
      end: Number((seg.end + clipStart).toFixed(2)),
    }));
    const cues = transcriptToSubtitles(shiftedSegs, clipStart, clipEnd, wordsPerBlock);
    onProgress?.(100, 'Segmentación vocal lista.');

    return {
      transcript: shiftedSegs,
      subtitles: cues,
      engineUsed: 'Detección de Voz Acústica (Offline)',
    };
  }
}

export function buildEditorSettingsForClip(
  config: ProjectConfig,
  start: number,
  end: number,
  faceKeyframes: FaceKeyframe[] = [],
  faceEngineUsed?: string
): EditorSettings {
  const trackActive = Boolean(config.autoFaceTrack && faceKeyframes.length > 0);
  return {
    ...DEFAULT_SETTINGS,
    ...getPresetPatch(config.subtitlePreset),
    ratio: config.ratio,
    fitMode: config.framing,
    trimStart: Number(start.toFixed(1)),
    trimEnd: Number(end.toFixed(1)),
    progressBar: config.generateProgressBar,
    faceTracking: trackActive,
    faceKeyframes,
    faceEngineUsed,
  };
}

function detectViralClips(
  duration: number,
  transcript: TranscriptSegment[],
  acoustic: AcousticAnalysis,
  visualDiffs: number[],
  config: ProjectConfig,
  allFaceKeyframes: FaceKeyframe[] = [],
  faceEngineUsed?: string
): GeneratedClip[] {
  const targetLen =
    config.targetDuration === '<30s'
      ? Math.min(24, duration)
      : config.targetDuration === '30-60s'
      ? Math.min(46, duration)
      : Math.min(34, Math.max(12, duration * 0.45));

  const minLen = Math.min(duration, 8);
  const step = Math.max(3, Math.floor(targetLen * 0.45));
  const candidates: Array<{
    start: number;
    end: number;
    score: number;
    breakdown: SignalBreakdown;
  }> = [];

  for (let start = 0; start <= Math.max(0, duration - minLen); start += step) {
    const end = Math.min(duration, start + targetLen);
    if (end - start < minLen) continue;

    const startBin = Math.floor(start / acoustic.binDuration);
    const endBin = Math.min(acoustic.rmsBins.length - 1, Math.ceil(end / acoustic.binDuration));
    const bins = acoustic.rmsBins.slice(startBin, Math.max(startBin + 1, endBin));

    const meanRms = bins.reduce((a, b) => a + b, 0) / Math.max(1, bins.length);
    const maxRms = Math.max(...bins, 0.01);
    const activeBins = bins.filter((b) => b > acoustic.noiseFloor).length;
    const speechRatio = activeBins / Math.max(1, bins.length);

    const hookBins = bins.slice(0, 12);
    const hookMean = hookBins.reduce((a, b) => a + b, 0) / Math.max(1, hookBins.length);

    const vocalEnergy = Number(
      Math.min(9.9, Math.max(3.5, (meanRms / acoustic.peakRms) * 11 + (maxRms / acoustic.peakRms) * 2)).toFixed(1)
    );
    const pacing = Number(Math.min(9.8, Math.max(3.8, speechRatio * 10.5)).toFixed(1));
    const hookStrength = Number(
      Math.min(9.9, Math.max(3.6, (hookMean / acoustic.peakRms) * 12)).toFixed(1)
    );

    const visIdxStart = Math.floor((start / Math.max(1, duration)) * visualDiffs.length);
    const visIdxEnd = Math.max(
      visIdxStart + 1,
      Math.ceil((end / Math.max(1, duration)) * visualDiffs.length)
    );
    const visSlice = visualDiffs.slice(visIdxStart, visIdxEnd);
    const visMean = visSlice.reduce((a, b) => a + b, 0) / Math.max(1, visSlice.length);
    const visualDynamics = Number(Math.min(9.8, Math.max(4.0, visMean * 10.5)).toFixed(1));

    const weightedScore = Math.round(
      ((vocalEnergy * 0.3 + pacing * 0.25 + hookStrength * 0.3 + visualDynamics * 0.15) / 10) *
        100
    );

    candidates.push({
      start: Number(start.toFixed(1)),
      end: Number(end.toFixed(1)),
      score: Math.min(98, Math.max(52, weightedScore)),
      breakdown: { vocalEnergy, pacing, hookStrength, visualDynamics },
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      start: 0,
      end: Number(duration.toFixed(1)),
      score: 84,
      breakdown: { vocalEnergy: 8.2, pacing: 8.4, hookStrength: 8.6, visualDynamics: 7.8 },
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected: typeof candidates = [];
  for (const cand of candidates) {
    const overlaps = selected.some(
      (s) => Math.min(s.end, cand.end) - Math.max(s.start, cand.start) > (cand.end - cand.start) * 0.35
    );
    if (!overlaps) {
      selected.push(cand);
      if (selected.length >= 5) break;
    }
  }

  return selected.map((cand, idx) => {
    const cues = transcriptToSubtitles(transcript, cand.start, cand.end, 3);
    const snippet = cues.map((c) => c.text.replace(/\*/g, '')).join(' ').trim();
    const firstWords = snippet.split(/\s+/).slice(0, 6).join(' ');
    const title =
      firstWords && !firstWords.startsWith('Segmento de voz') && !firstWords.startsWith('Bloque')
        ? `${firstWords}${snippet.split(/\s+/).length > 6 ? '…' : ''}`
        : `Momento Destacado #${idx + 1} (${Math.round(cand.start)}s–${Math.round(cand.end)}s)`;

    const reasons: string[] = [];
    if (cand.breakdown.hookStrength >= 7.5) reasons.push('gancho vocal fuerte en los primeros 3s');
    if (cand.breakdown.pacing >= 7.5) reasons.push('ritmo continuo sin pausas largas');
    if (cand.breakdown.vocalEnergy >= 7.5) reasons.push('alta intensidad vocal');
    if (cand.breakdown.visualDynamics >= 7.0) reasons.push('buen movimiento visual');
    const viralReason =
      reasons.length > 0
        ? `Detectado por ${reasons.join(' y ')}.`
        : 'Segmento equilibrado con densidad vocal y duración ideal para formato corto.';

    const keywords = extractKeywords(snippet);
    const clipFaces = allFaceKeyframes.filter(
      (kf) => kf.time >= cand.start - 0.5 && kf.time <= cand.end + 0.5
    );

    return {
      id: `clip_${Date.now()}_${idx}`,
      title,
      start: cand.start,
      end: cand.end,
      duration: Number((cand.end - cand.start).toFixed(1)),
      score: cand.score,
      viralReason,
      keywords: keywords.length > 0 ? keywords : ['short', 'viral', 'clip'],
      signalBreakdown: cand.breakdown,
      subtitles: cues,
      editorSettings: buildEditorSettingsForClip(
        config,
        cand.start,
        cand.end,
        clipFaces,
        faceEngineUsed
      ),
      transcriptSnippet: snippet || 'Transcripción editable en ShortStudio.',
    };
  });
}

export async function analyzeVideoLocally(params: {
  blob: Blob;
  title: string;
  mediaBlobId: string;
  config: ProjectConfig;
  aiEngine: AiEngineMode;
  whisperModel: WhisperModelId;
  onProgress: (pct: number, stepText: string) => void;
}): Promise<ClipProject> {
  const { blob, title, mediaBlobId, config, aiEngine, whisperModel, onProgress } = params;

  onProgress(8, 'Extrayendo metadatos y miniatura del video...');
  const meta = await extractVideoMetadataAndThumbnail(blob);

  onProgress(18, 'Decodificando pista de audio PCM (16kHz)...');
  const pcm16k = await extractMonoAudio16k(blob);

  onProgress(26, 'Analizando energía vocal y dinámica de fotogramas...');
  const acoustic = analyzeAcousticEnvelope(pcm16k, meta.duration);
  const visualDiffs = await sampleVisualDynamics(blob, meta.duration);

  let transcript: TranscriptSegment[] = acoustic.speechSegments;
  let engineUsed = 'Señales Acústicas Locales (Gratis)';

  if (aiEngine === 'whisper-local' && pcm16k && pcm16k.length > 0) {
    try {
      onProgress(34, 'Iniciando transcripción con Whisper local...');
      const whisperSegs = await runWhisperWorker(
        pcm16k,
        whisperModel,
        config.language,
        (pct, msg) => onProgress(Math.min(68, pct), msg)
      );
      if (whisperSegs.length > 0) {
        transcript = whisperSegs;
        engineUsed = `Whisper Local (${whisperModel.replace('Xenova/', '')} · Gratis)`;
      }
    } catch {
      engineUsed = 'Señales Acústicas Locales (Respaldo offline)';
    }
  }

  let faceKeyframes: FaceKeyframe[] = [];
  let faceEngineUsed: string | undefined;
  if (config.autoFaceTrack) {
    try {
      const tracked = await trackFacesInVideo({
        source: blob,
        start: 0,
        end: meta.duration,
        smoothing: 72,
        sampleFps: 1.5,
        maxSamples: 45,
        onProgress: (pct, msg) => {
          const mapped = 68 + Math.round((pct / 100) * 22);
          onProgress(mapped, msg);
        },
      });
      faceKeyframes = tracked.keyframes;
      faceEngineUsed = tracked.engineUsed;
    } catch {
      faceKeyframes = [];
    }
  }

  onProgress(93, 'Calculando puntuación viral y generando clips...');
  const clips = detectViralClips(
    meta.duration,
    transcript,
    acoustic,
    visualDiffs,
    config,
    faceKeyframes,
    faceEngineUsed
  );

  onProgress(100, 'Proyecto completado.');
  const now = new Date().toISOString();

  return {
    id: `proj_${Date.now()}`,
    title,
    status: 'completed',
    createdAt: now,
    updatedAt: now,
    mediaBlobId,
    mediaName: title,
    isDemo: false,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    thumbnailDataUrl: meta.thumbnailDataUrl,
    config,
    transcript,
    clips,
    aiEngineUsed: faceEngineUsed ? `${engineUsed} · ${faceEngineUsed}` : engineUsed,
  };
}

export async function createManualProjectShell(params: {
  blob: Blob;
  title: string;
  mediaBlobId: string;
  config: ProjectConfig;
}): Promise<ClipProject> {
  const { blob, title, mediaBlobId, config } = params;
  const meta = await extractVideoMetadataAndThumbnail(blob);
  const now = new Date().toISOString();

  return {
    id: `proj_${Date.now()}`,
    title,
    status: 'completed',
    createdAt: now,
    updatedAt: now,
    mediaBlobId,
    mediaName: title,
    isDemo: false,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    thumbnailDataUrl: meta.thumbnailDataUrl,
    config,
    transcript: [],
    clips: [],
    aiEngineUsed: 'Creación Manual de Clips',
  };
}

export async function createManualClip(params: {
  project: ClipProject;
  start: number;
  end: number;
  title?: string;
  source: Blob | string | null;
  whisperModel: WhisperModelId;
  transcribeAudio?: boolean;
  trackFaces?: boolean;
  onProgress?: (pct: number, label: string) => void;
}): Promise<{
  clip: GeneratedClip;
  addedTranscript: TranscriptSegment[];
  engineNote?: string;
}> {
  const {
    project,
    source,
    whisperModel,
    transcribeAudio = false,
    trackFaces = false,
    onProgress,
  } = params;

  const maxDur = Math.max(1, project.duration);
  const safeStart = Number(Math.max(0, Math.min(maxDur - 0.5, params.start)).toFixed(1));
  const safeEnd = Number(
    Math.min(maxDur, Math.max(safeStart + 0.5, params.end)).toFixed(1)
  );
  const clipDur = Number((safeEnd - safeStart).toFixed(1));

  let cues = transcriptToSubtitles(project.transcript, safeStart, safeEnd, 3);
  let addedTranscript: TranscriptSegment[] = [];
  let engineNote: string | undefined;

  if (cues.length === 0 && transcribeAudio && source && !project.isDemo) {
    onProgress?.(15, 'Transcribiendo fragmento con Whisper local...');
    const res = await transcribeVideoRange({
      source,
      start: safeStart,
      end: safeEnd,
      language: project.config.language,
      modelId: whisperModel,
      wordsPerBlock: 3,
      onProgress: (pct, msg) => {
        const mapped = trackFaces ? Math.round(pct * 0.6) : pct;
        onProgress?.(mapped, msg);
      },
    });
    cues = res.subtitles;
    addedTranscript = res.transcript;
    engineNote = res.engineUsed;
  }

  let faceKeyframes: FaceKeyframe[] = [];
  let faceEngineUsed: string | undefined;
  if (trackFaces) {
    if (project.isDemo) {
      faceKeyframes = createDemoFaceKeyframes(safeStart, safeEnd);
      faceEngineUsed = 'Seguimiento Demo IA';
    } else if (source) {
      try {
        onProgress?.(transcribeAudio ? 65 : 20, 'Detectando rostro en el fragmento...');
        const tracked = await trackFacesInVideo({
          source,
          start: safeStart,
          end: safeEnd,
          smoothing: 72,
          sampleFps: 1.5,
          maxSamples: 30,
          onProgress: (pct, msg) => {
            const base = transcribeAudio ? 65 : 20;
            onProgress?.(Math.min(96, base + Math.round((pct / 100) * (96 - base))), msg);
          },
        });
        faceKeyframes = tracked.keyframes;
        faceEngineUsed = tracked.engineUsed;
      } catch {
        faceKeyframes = [];
      }
    }
  }

  onProgress?.(100, 'Clip manual listo');

  const snippet = cues.map((c) => c.text.replace(/\*/g, '')).join(' ').trim();
  const cleanTitle = params.title?.trim();
  const clipIndex = project.clips.length + 1;
  const finalTitle =
    cleanTitle ||
    `Clip Manual #${clipIndex} (${Math.floor(safeStart)}s–${Math.ceil(safeEnd)}s)`;

  const keywords = extractKeywords(snippet);
  const editorConfig: ProjectConfig = {
    ...project.config,
    autoFaceTrack: Boolean(trackFaces && faceKeyframes.length > 0),
  };

  const clip: GeneratedClip = {
    id: `clip_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: finalTitle,
    start: safeStart,
    end: safeEnd,
    duration: clipDur,
    score: 90,
    viralReason: 'Clip recortado manualmente por el usuario.',
    keywords: keywords.length > 0 ? keywords : ['manual', 'short', 'clip'],
    signalBreakdown: {
      vocalEnergy: 8.5,
      pacing: 8.8,
      hookStrength: 8.7,
      visualDynamics: 8.5,
    },
    subtitles: cues,
    editorSettings: buildEditorSettingsForClip(
      editorConfig,
      safeStart,
      safeEnd,
      faceKeyframes,
      faceEngineUsed
    ),
    transcriptSnippet: snippet || 'Clip manual listo para editar en ShortStudio.',
  };

  return { clip, addedTranscript, engineNote };
}

export function createDemoProject(config: ProjectConfig): ClipProject {
  const now = new Date().toISOString();
  const baseSubs = DEFAULT_SUBTITLES;
  const demoFaces1 = config.autoFaceTrack ? createDemoFaceKeyframes(0, 12) : [];
  const demoFaces2 = config.autoFaceTrack ? createDemoFaceKeyframes(4.5, 11.8) : [];

  const clips: GeneratedClip[] = [
    {
      id: `clip_demo_${Date.now()}_1`,
      title: 'Los primeros 3 segundos deciden tu alcance',
      start: 0,
      end: 12,
      duration: 12,
      score: 94,
      viralReason: 'Detectado por gancho vocal fuerte en los primeros 3s y ritmo continuo.',
      keywords: ['viral', 'segundos', 'retención', 'shorts'],
      signalBreakdown: {
        vocalEnergy: 9.2,
        pacing: 9.4,
        hookStrength: 9.6,
        visualDynamics: 8.8,
      },
      subtitles: baseSubs,
      editorSettings: buildEditorSettingsForClip(
        config,
        0,
        12,
        demoFaces1,
        config.autoFaceTrack ? 'Seguimiento Demo IA' : undefined
      ),
      transcriptSnippet: baseSubs.map((s) => s.text.replace(/\*/g, '')).join(' '),
    },
    {
      id: `clip_demo_${Date.now()}_2`,
      title: 'Gancho rápido: edita como un pro en 9:16',
      start: 4.5,
      end: 11.8,
      duration: 7.3,
      score: 88,
      viralReason: 'Segmento compacto ideal para bucle infinito y retención alta.',
      keywords: ['edita', 'vertical', '9:16'],
      signalBreakdown: {
        vocalEnergy: 8.5,
        pacing: 9.0,
        hookStrength: 8.7,
        visualDynamics: 8.6,
      },
      subtitles: baseSubs.slice(2),
      editorSettings: buildEditorSettingsForClip(
        config,
        4.5,
        11.8,
        demoFaces2,
        config.autoFaceTrack ? 'Seguimiento Demo IA' : undefined
      ),
      transcriptSnippet: baseSubs
        .slice(2)
        .map((s) => s.text.replace(/\*/g, ''))
        .join(' '),
    },
  ];

  return {
    id: `proj_demo_${Date.now()}`,
    title: 'Proyecto Demo KellyClipAi (16:9 → 9:16)',
    status: 'completed',
    createdAt: now,
    updatedAt: now,
    mediaBlobId: null,
    mediaName: 'demo-studio-16x9.mp4',
    isDemo: true,
    duration: 12,
    width: 1920,
    height: 1080,
    thumbnailDataUrl: null,
    config,
    transcript: baseSubs.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.replace(/\*/g, ''),
    })),
    clips,
    aiEngineUsed: 'Demo Local Integrado (Gratis)',
  };
}
