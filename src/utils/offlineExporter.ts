import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import {
  EditorSettings,
  GeneratedClip,
  getCanvasDimensions,
  SpeechSegment,
  SubtitleCue,
} from '../types/editor';
import { renderEditorFrame } from './canvasRenderer';
import { getEffectiveSpeechSegments, outputTimeToSourceTime } from './clipTiming';
import { formatTime } from './srt';

export interface OfflineExportParams {
  source: Blob | string | null;
  mediaBlobId?: string | null;
  isDemo: boolean;
  bgmUrl: string | null;
  hasBgm: boolean;
  settings: EditorSettings;
  subtitles: SubtitleCue[];
  signal: { canceled: boolean };
  onProgress: (pct: number, statusText: string) => void;
}

export type OfflineExportResult =
  | { ok: true; blob: Blob; usedServerMux: boolean; savedPath?: string }
  | { ok: false; canceled: boolean; fallbackNeeded: boolean; reason?: string };

const EXPORT_FPS = 30;
const AUDIO_SAMPLE_RATE = 48000;
const CHUNK_UPLOAD_BYTES = 12 * 1024 * 1024; // Safe under Cloud Run 32MB limit

const H264_CODEC_CANDIDATES = [
  'avc1.64002a', // High L4.2 (1080p@60)
  'avc1.4d002a', // Main L4.2
  'avc1.42002a', // Baseline L4.2
  'avc1.4d0028', // Main L4.0 (1080p@30)
  'avc1.42E01E', // Baseline L3.1
];

async function decodeMediaAudio(input: Blob | string): Promise<AudioBuffer | null> {
  try {
    let arrayBuffer: ArrayBuffer;
    if (typeof input === 'string') {
      const resp = await fetch(input);
      if (!resp.ok) return null;
      arrayBuffer = await resp.arrayBuffer();
    } else {
      arrayBuffer = await input.arrayBuffer();
    }

    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const tempCtx = new AudioCtxClass();
    try {
      return await tempCtx.decodeAudioData(arrayBuffer);
    } finally {
      await tempCtx.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

async function renderExactAudioMix(params: {
  source: Blob | string | null;
  isDemo: boolean;
  bgmUrl: string | null;
  hasBgm: boolean;
  segments: SpeechSegment[];
  outDuration: number;
  speed: number;
  volVideo: number;
  volBgm: number;
}): Promise<AudioBuffer> {
  const {
    source,
    isDemo,
    bgmUrl,
    hasBgm,
    segments,
    outDuration,
    speed,
    volVideo,
    volBgm,
  } = params;

  const totalSamples = Math.max(1, Math.ceil(outDuration * AUDIO_SAMPLE_RATE));
  const offline = new OfflineAudioContext(2, totalSamples, AUDIO_SAMPLE_RATE);

  const [videoAudio, bgmAudio] = await Promise.all([
    !isDemo && source && volVideo > 0 ? decodeMediaAudio(source) : Promise.resolve(null),
    hasBgm && bgmUrl && volBgm > 0 ? decodeMediaAudio(bgmUrl) : Promise.resolve(null),
  ]);

  if (videoAudio) {
    let outCursor = 0;
    for (const seg of segments) {
      const safeOffset = Math.min(Math.max(0, seg.start), Math.max(0, videoAudio.duration - 0.01));
      const segDur = Math.max(0, Math.min(seg.end - safeOffset, videoAudio.duration - safeOffset));
      if (segDur > 0.02) {
        const srcNode = offline.createBufferSource();
        srcNode.buffer = videoAudio;
        srcNode.playbackRate.value = speed;
        const gain = offline.createGain();
        gain.gain.value = Math.max(0, Math.min(2, volVideo / 100));
        srcNode.connect(gain);
        gain.connect(offline.destination);
        srcNode.start(outCursor, safeOffset, segDur);
        outCursor += segDur / speed;
      }
    }
  }

  if (bgmAudio) {
    const bgmNode = offline.createBufferSource();
    bgmNode.buffer = bgmAudio;
    bgmNode.loop = true;
    const bgmGain = offline.createGain();
    bgmGain.gain.value = Math.max(0, Math.min(2, volBgm / 100));
    bgmNode.connect(bgmGain);
    bgmGain.connect(offline.destination);
    bgmNode.start(0, 0, outDuration);
  }

  return offline.startRendering();
}

function encodeAudioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const numChannels = 2;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const s0 = Math.max(-1, Math.min(1, ch0[i]));
    const s1 = Math.max(-1, Math.min(1, ch1[i]));
    view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true);
    view.setInt16(offset + 2, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true);
    offset += 4;
  }

  return buffer;
}

async function selectVideoEncoderConfig(
  width: number,
  height: number
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder !== 'function') return null;

  for (const codec of H264_CODEC_CANDIDATES) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: 5_000_000,
      framerate: EXPORT_FPS,
      avc: { format: 'avc' },
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return support.config || config;
      }
    } catch {
      // try next profile/level
    }
  }
  return null;
}

async function selectAudioEncoderConfig(): Promise<AudioEncoderConfig | null> {
  if (typeof AudioEncoder !== 'function' || typeof AudioData !== 'function') return null;
  for (const bitrate of [192_000, 128_000]) {
    const config: AudioEncoderConfig = {
      codec: 'mp4a.40.2',
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels: 2,
      bitrate,
    };
    try {
      const support = await AudioEncoder.isConfigSupported(config);
      if (support.supported) {
        return support.config || config;
      }
    } catch {
      // unsupported
    }
  }
  return null;
}

async function seekVideoExact(
  video: HTMLVideoElement,
  targetTime: number,
  maxTime: number
): Promise<void> {
  const clamped = Math.max(0, Math.min(maxTime, targetTime));
  if (Math.abs(video.currentTime - clamped) < 0.004 && video.readyState >= 2) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('seeked', done);
      resolve();
    };
    const timer = window.setTimeout(done, 1500);
    video.addEventListener('seeked', done);
    video.currentTime = clamped;
  });
}

export async function uploadBlobInChunks(
  blob: Blob,
  part: 'video' | 'audio',
  jobId: string
): Promise<void> {
  for (let offset = 0; offset < blob.size; offset += CHUNK_UPLOAD_BYTES) {
    const chunk = blob.slice(offset, Math.min(blob.size, offset + CHUNK_UPLOAD_BYTES));
    const res = await fetch(`/api/media-job/${jobId}/append?part=${part}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chunk,
    });
    if (!res.ok) {
      throw new Error(`Error subiendo parte ${part} (HTTP ${res.status})`);
    }
  }
}

export async function transcodeVideoViaMediaJob(videoBlob: Blob): Promise<Blob> {
  if (videoBlob.size <= 16 * 1024 * 1024) {
    const res = await fetch('/api/transcode-mp4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: videoBlob,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  }

  const initRes = await fetch('/api/media-job/init', { method: 'POST' });
  if (!initRes.ok) throw new Error(`HTTP ${initRes.status}`);
  const { jobId } = (await initRes.json()) as { jobId: string };

  await uploadBlobInChunks(videoBlob, 'video', jobId);

  const txRes = await fetch(`/api/media-job/${jobId}/transcode`, { method: 'POST' });
  if (!txRes.ok) throw new Error(`HTTP ${txRes.status}`);
  return txRes.blob();
}

async function muxVideoAndWavOnServer(videoBuf: ArrayBuffer, wavBuf: ArrayBuffer): Promise<Blob> {
  const initRes = await fetch('/api/media-job/init', { method: 'POST' });
  if (!initRes.ok) throw new Error(`HTTP ${initRes.status}`);
  const { jobId } = (await initRes.json()) as { jobId: string };

  await uploadBlobInChunks(new Blob([videoBuf]), 'video', jobId);
  await uploadBlobInChunks(new Blob([wavBuf]), 'audio', jobId);

  const muxRes = await fetch(`/api/media-job/${jobId}/mux`, { method: 'POST' });
  if (!muxRes.ok) throw new Error(`HTTP ${muxRes.status}`);
  return muxRes.blob();
}

export async function exportClipWithFfmpeg(
  params: OfflineExportParams & {
    bgmBlob?: Blob | null;
    saveToBatchFolder?: { projectTitle: string; fileName: string };
  }
): Promise<OfflineExportResult> {
  const {
    source,
    mediaBlobId,
    isDemo,
    bgmBlob,
    hasBgm,
    settings,
    subtitles,
    saveToBatchFolder,
    signal,
    onProgress,
  } = params;

  if (isDemo || (!source && !mediaBlobId)) {
    return { ok: false, canceled: false, fallbackNeeded: true, reason: 'Sin video fuente' };
  }

  try {
    const canUseDiskMediaId = Boolean(
      mediaBlobId &&
        /^[a-zA-Z0-9_-]{4,80}$/.test(mediaBlobId) &&
        typeof source === 'string' &&
        source.includes('/api/local-media/')
    );

    const initRes = await fetch('/api/media-job/init', { method: 'POST' });
    if (!initRes.ok) {
      return { ok: false, canceled: false, fallbackNeeded: true };
    }
    const { jobId } = (await initRes.json()) as { jobId: string };

    if (!canUseDiskMediaId) {
      onProgress(6, 'Preparando archivo para renderizado FFmpeg nativo...');
      let videoBlob: Blob;
      if (source instanceof Blob) {
        videoBlob = source;
      } else if (typeof source === 'string') {
        const resp = await fetch(source);
        if (!resp.ok) {
          return { ok: false, canceled: false, fallbackNeeded: true };
        }
        videoBlob = await resp.blob();
      } else {
        return { ok: false, canceled: false, fallbackNeeded: true };
      }

      if (signal.canceled) {
        return { ok: false, canceled: true, fallbackNeeded: false };
      }

      onProgress(22, 'Enviando pista de video al motor FFmpeg...');
      await uploadBlobInChunks(videoBlob, 'video', jobId);
    } else {
      onProgress(28, 'Leyendo video original directamente desde disco...');
    }

    if (signal.canceled) {
      return { ok: false, canceled: true, fallbackNeeded: false };
    }

    if (hasBgm && bgmBlob && bgmBlob.size > 0 && settings.volBgm > 0) {
      onProgress(42, 'Enviando música de fondo...');
      await uploadBlobInChunks(bgmBlob, 'audio', jobId);
    }

    if (signal.canceled) {
      return { ok: false, canceled: true, fallbackNeeded: false };
    }

    onProgress(58, 'Renderizando 9:16, cortes de silencio, gancho y subtítulos con FFmpeg...');
    const res = await fetch(`/api/media-job/${jobId}/export-ffmpeg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaId: canUseDiskMediaId ? mediaBlobId : undefined,
        saveToBatchFolder,
        settings,
        subtitles,
      }),
    });

    if (!res.ok) {
      return { ok: false, canceled: false, fallbackNeeded: true };
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      const json = (await res.json()) as { ok?: boolean; savedPath?: string };
      if (!json.ok) {
        return { ok: false, canceled: false, fallbackNeeded: true };
      }
      onProgress(100, '¡MP4 guardado en carpeta de Lote!');
      return {
        ok: true,
        blob: new Blob([], { type: 'video/mp4' }),
        usedServerMux: true,
        savedPath: json.savedPath,
      };
    }

    const blob = await res.blob();
    if (signal.canceled) {
      return { ok: false, canceled: true, fallbackNeeded: false };
    }
    if (blob.size === 0) {
      return { ok: false, canceled: false, fallbackNeeded: true };
    }

    onProgress(100, '¡MP4 ultra-rápido listo!');
    return { ok: true, blob, usedServerMux: true };
  } catch {
    if (signal.canceled) {
      return { ok: false, canceled: true, fallbackNeeded: false };
    }
    return { ok: false, canceled: false, fallbackNeeded: true };
  }
}

export async function exportClipOffline(
  params: OfflineExportParams
): Promise<OfflineExportResult> {
  const { source, isDemo, bgmUrl, hasBgm, settings, subtitles, signal, onProgress } = params;

  if (typeof VideoFrame !== 'function' || typeof VideoEncoder !== 'function') {
    return { ok: false, canceled: false, fallbackNeeded: true };
  }

  const dims = getCanvasDimensions(settings.ratio);
  const cw = dims.width;
  const ch = dims.height;
  const resLabel = `${cw}×${ch}`;

  const videoEncoderConfig = await selectVideoEncoderConfig(cw, ch);
  if (!videoEncoderConfig) {
    return { ok: false, canceled: false, fallbackNeeded: true };
  }

  const audioEncoderConfig = await selectAudioEncoderConfig();

  let exportVideo: HTMLVideoElement | null = null;
  let tempVideoUrl: string | null = null;
  let videoEncoder: VideoEncoder | null = null;
  let audioEncoder: AudioEncoder | null = null;

  try {
    onProgress(2, `Preparando pista de audio exacta (48kHz)...`);

    let effectiveTrimEnd = settings.trimEnd;
    let maxVideoTime = settings.trimEnd;

    if (!isDemo) {
      if (!source) {
        return { ok: false, canceled: false, fallbackNeeded: true, reason: 'Sin fuente de video' };
      }
      exportVideo = document.createElement('video');
      exportVideo.muted = true;
      exportVideo.playsInline = true;
      exportVideo.crossOrigin = 'anonymous';
      exportVideo.preload = 'auto';

      if (source instanceof Blob) {
        tempVideoUrl = URL.createObjectURL(source);
        exportVideo.src = tempVideoUrl;
      } else {
        exportVideo.src = source;
      }

      await new Promise<void>((resolve, reject) => {
        if (!exportVideo) return reject(new Error('No video'));
        if (exportVideo.readyState >= 2) {
          resolve();
          return;
        }
        const timer = window.setTimeout(() => reject(new Error('Timeout cargando video')), 15000);
        const onLoaded = () => {
          window.clearTimeout(timer);
          cleanup();
          resolve();
        };
        const onErr = () => {
          window.clearTimeout(timer);
          cleanup();
          reject(new Error('Error decodificando fuente de video'));
        };
        const cleanup = () => {
          exportVideo?.removeEventListener('loadeddata', onLoaded);
          exportVideo?.removeEventListener('error', onErr);
        };
        exportVideo.addEventListener('loadeddata', onLoaded);
        exportVideo.addEventListener('error', onErr);
        exportVideo.load();
      });

      if (Number.isFinite(exportVideo.duration) && exportVideo.duration > 0) {
        effectiveTrimEnd = Math.min(settings.trimEnd, exportVideo.duration);
        maxVideoTime = Math.max(0, exportVideo.duration - 0.02);
      }
    }

    if (signal.canceled) {
      return { ok: false, canceled: true, fallbackNeeded: false };
    }

    const effectiveTrimStart = Math.min(settings.trimStart, Math.max(0, effectiveTrimEnd - 0.1));
    const speed = Math.max(0.25, Math.min(4, settings.speed || 1));
    const clampedSettings: EditorSettings = {
      ...settings,
      trimStart: effectiveTrimStart,
      trimEnd: effectiveTrimEnd,
    };
    const segments = getEffectiveSpeechSegments(clampedSettings);
    const srcDuration = Math.max(
      0.1,
      segments.reduce((acc, seg) => acc + Math.max(0, seg.end - seg.start), 0)
    );
    const outDuration = srcDuration / speed;
    const totalFrames = Math.max(1, Math.round(outDuration * EXPORT_FPS));
    const frameDurUs = Math.round(1_000_000 / EXPORT_FPS);

    const renderedAudio = await renderExactAudioMix({
      source,
      isDemo,
      bgmUrl,
      hasBgm,
      segments,
      outDuration,
      speed,
      volVideo: settings.volVideo,
      volBgm: settings.volBgm,
    });

    if (signal.canceled) {
      return { ok: false, canceled: true, fallbackNeeded: false };
    }

    const useClientAudioEncoder = Boolean(audioEncoderConfig);
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width: cw,
        height: ch,
        frameRate: EXPORT_FPS,
      },
      audio: useClientAudioEncoder
        ? {
            codec: 'aac',
            numberOfChannels: 2,
            sampleRate: AUDIO_SAMPLE_RATE,
          }
        : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    let encoderErr: Error | null = null;

    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (err) => {
        encoderErr = err instanceof Error ? err : new Error(String(err));
      },
    });
    videoEncoder.configure(videoEncoderConfig);

    if (useClientAudioEncoder && audioEncoderConfig) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (err) => {
          encoderErr = err instanceof Error ? err : new Error(String(err));
        },
      });
      audioEncoder.configure(audioEncoderConfig);
    }

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = cw;
    exportCanvas.height = ch;
    const ctx = exportCanvas.getContext('2d', { alpha: false });
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = Math.max(64, Math.round(cw / 8));
    blurCanvas.height = Math.max(64, Math.round(ch / 8));
    const blurCtx = blurCanvas.getContext('2d', { alpha: false });

    if (!ctx || !blurCtx) {
      return { ok: false, canceled: false, fallbackNeeded: true };
    }

    // Encode deterministic audio first if client AAC encoder is active
    if (audioEncoder) {
      const chunkFrames = 4096;
      const ch0 = renderedAudio.getChannelData(0);
      const ch1 = renderedAudio.numberOfChannels > 1 ? renderedAudio.getChannelData(1) : ch0;

      for (let offset = 0; offset < renderedAudio.length; offset += chunkFrames) {
        if (signal.canceled || encoderErr) break;
        const frames = Math.min(chunkFrames, renderedAudio.length - offset);
        const planar = new Float32Array(frames * 2);
        planar.set(ch0.subarray(offset, offset + frames), 0);
        planar.set(ch1.subarray(offset, offset + frames), frames);

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: AUDIO_SAMPLE_RATE,
          numberOfChannels: 2,
          numberOfFrames: frames,
          timestamp: Math.round((offset / AUDIO_SAMPLE_RATE) * 1_000_000),
          data: planar,
        });
        audioEncoder.encode(audioData);
        audioData.close();

        while (audioEncoder.encodeQueueSize >= 12 && !signal.canceled && !encoderErr) {
          await new Promise((r) => window.setTimeout(r, 4));
        }
      }
      if (!signal.canceled && !encoderErr) {
        await audioEncoder.flush();
      }
    }

    if (signal.canceled) {
      return { ok: false, canceled: true, fallbackNeeded: false };
    }
    if (encoderErr) {
      return { ok: false, canceled: false, fallbackNeeded: true };
    }

    // Encode exact 30.000 fps video frames matched 1:1 to source timeline & subtitles
    for (let i = 0; i < totalFrames; i++) {
      if (signal.canceled) {
        return { ok: false, canceled: true, fallbackNeeded: false };
      }
      if (encoderErr) {
        return { ok: false, canceled: false, fallbackNeeded: true };
      }

      const outTimeSec = i / EXPORT_FPS;
      const srcTime = outputTimeToSourceTime(outTimeSec, segments, speed);

      if (!isDemo && exportVideo) {
        await seekVideoExact(exportVideo, srcTime, maxVideoTime);
      }

      renderEditorFrame({
        ctx,
        blurCanvas,
        blurCtx,
        video: exportVideo,
        hasMedia: !isDemo,
        isDemo,
        currentTime: srcTime,
        settings: clampedSettings,
        subtitles,
      });

      while (videoEncoder.encodeQueueSize >= 6 && !signal.canceled && !encoderErr) {
        await new Promise((r) => window.setTimeout(r, 6));
      }

      const timestampUs = Math.round(outTimeSec * 1_000_000);
      const frame = new VideoFrame(exportCanvas, {
        timestamp: timestampUs,
        duration: frameDurUs,
      });
      videoEncoder.encode(frame, { keyFrame: i % 60 === 0 });
      frame.close();

      if (i % 3 === 0 || i === totalFrames - 1) {
        const pct = 5 + ((i + 1) / totalFrames) * (useClientAudioEncoder ? 92 : 85);
        onProgress(
          pct,
          `Renderizando ${resLabel} · ${Math.round(pct)}% (${formatTime(outTimeSec)} / ${formatTime(outDuration)})`
        );
        if (isDemo) {
          await new Promise((r) => window.setTimeout(r, 0));
        }
      }
    }

    if (signal.canceled) {
      return { ok: false, canceled: true, fallbackNeeded: false };
    }

    onProgress(94, 'Empaquetando video MP4 (H.264 + AAC)...');
    await videoEncoder.flush();
    if (encoderErr) {
      return { ok: false, canceled: false, fallbackNeeded: true };
    }

    muxer.finalize();
    const mp4Buffer = target.buffer;

    if (useClientAudioEncoder) {
      onProgress(100, '¡MP4 listo!');
      return {
        ok: true,
        blob: new Blob([mp4Buffer], { type: 'video/mp4' }),
        usedServerMux: false,
      };
    }

    onProgress(95, 'Uniendo pista de audio AAC en alta precisión...');
    const wavBuf = encodeAudioBufferToWav(renderedAudio);
    const muxedBlob = await muxVideoAndWavOnServer(mp4Buffer, wavBuf);
    onProgress(100, '¡MP4 listo!');
    return {
      ok: true,
      blob: muxedBlob,
      usedServerMux: true,
    };
  } catch {
    if (signal.canceled) {
      return { ok: false, canceled: true, fallbackNeeded: false };
    }
    return { ok: false, canceled: false, fallbackNeeded: true };
  } finally {
    try {
      if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close();
    } catch {
      // ignore
    }
    try {
      if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
    } catch {
      // ignore
    }
    if (exportVideo) {
      exportVideo.removeAttribute('src');
      exportVideo.load();
    }
    if (tempVideoUrl) {
      URL.revokeObjectURL(tempVideoUrl);
    }
  }
}

export interface BatchExportProgress {
  completed: number;
  total: number;
  currentIndex: number;
  currentClipTitle: string;
  currentClipPct: number;
  overallPct: number;
  statusText: string;
  savedPaths: string[];
  failedClips: string[];
}

export async function exportClipsBatch(params: {
  projectTitle: string;
  clips: GeneratedClip[];
  source: Blob | string | null;
  mediaBlobId: string | null;
  isDemo: boolean;
  engine: 'ffmpeg-fast' | 'mp4-h264';
  saveToPcFolder: boolean;
  signal: { canceled: boolean };
  onProgress: (p: BatchExportProgress) => void;
}): Promise<{
  canceled: boolean;
  completedCount: number;
  savedPaths: string[];
  failedClips: string[];
}> {
  const {
    projectTitle,
    clips,
    source,
    mediaBlobId,
    isDemo,
    engine,
    saveToPcFolder,
    signal,
    onProgress,
  } = params;

  const total = clips.length;
  const savedPaths: string[] = [];
  const failedClips: string[] = [];
  let completed = 0;

  const triggerDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 6000);
  };

  for (let i = 0; i < total; i++) {
    if (signal.canceled) {
      return { canceled: true, completedCount: completed, savedPaths, failedClips };
    }

    const clip = clips[i];
    const safeTitle = clip.title
      .replace(/[<>:"/\\|?*]+/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 40) || `Clip_${i + 1}`;
    const fileName = `${String(i + 1).padStart(2, '0')}_${safeTitle}.mp4`;

    const report = (clipPct: number, statusText: string) => {
      const overallPct = Math.min(100, Math.round(((i + clipPct / 100) / Math.max(1, total)) * 100));
      onProgress({
        completed,
        total,
        currentIndex: i,
        currentClipTitle: clip.title,
        currentClipPct: Math.round(clipPct),
        overallPct,
        statusText,
        savedPaths: [...savedPaths],
        failedClips: [...failedClips],
      });
    };

    report(2, `Iniciando clip ${i + 1} de ${total}: ${clip.title}`);

    let res: OfflineExportResult = { ok: false, canceled: false, fallbackNeeded: true };

    if (engine === 'ffmpeg-fast' && !isDemo) {
      res = await exportClipWithFfmpeg({
        source,
        mediaBlobId,
        isDemo,
        bgmUrl: null,
        hasBgm: false,
        settings: clip.editorSettings,
        subtitles: clip.subtitles,
        saveToBatchFolder: saveToPcFolder ? { projectTitle, fileName } : undefined,
        signal,
        onProgress: (pct, msg) => report(pct, msg),
      });
    }

    if (!res.ok && !res.canceled) {
      res = await exportClipOffline({
        source,
        mediaBlobId,
        isDemo,
        bgmUrl: null,
        hasBgm: false,
        settings: clip.editorSettings,
        subtitles: clip.subtitles,
        signal,
        onProgress: (pct, msg) => report(pct, msg),
      });
    }

    if ((!res.ok && res.canceled) || signal.canceled) {
      return { canceled: true, completedCount: completed, savedPaths, failedClips };
    }

    if (res.ok) {
      completed += 1;
      if (res.savedPath) {
        savedPaths.push(res.savedPath);
      } else if (res.blob.size > 0) {
        triggerDownload(res.blob, fileName);
        await new Promise((r) => window.setTimeout(r, 450));
      }
      report(100, `Clip ${i + 1}/${total} completado`);
    } else {
      failedClips.push(clip.title);
      report(100, `Error en ${clip.title}`);
    }
  }

  return {
    canceled: false,
    completedCount: completed,
    savedPaths,
    failedClips,
  };
}

