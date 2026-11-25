import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { FaceKeyframe } from '../types/editor';

let cachedFaceDetector: FaceDetector | null = null;
let faceDetectorPromise: Promise<FaceDetector | null> | null = null;

async function getMediaPipeFaceDetector(): Promise<FaceDetector | null> {
  if (cachedFaceDetector) return cachedFaceDetector;
  if (faceDetectorPromise) return faceDetectorPromise;

  faceDetectorPromise = (async () => {
    try {
      const timeoutPromise = new Promise<null>((resolve) =>
        window.setTimeout(() => resolve(null), 12_000)
      );

      const loadPromise = (async () => {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
        );
        try {
          return await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
              delegate: 'GPU',
            },
            runningMode: 'IMAGE',
            minDetectionConfidence: 0.42,
          });
        } catch {
          return await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
              delegate: 'CPU',
            },
            runningMode: 'IMAGE',
            minDetectionConfidence: 0.42,
          });
        }
      })();

      const detector = await Promise.race([loadPromise, timeoutPromise]);
      cachedFaceDetector = detector;
      return detector;
    } catch {
      return null;
    }
  })();

  return faceDetectorPromise;
}

interface RawDetection {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

// Local computer-vision fallback: YCbCr skin-tone likelihood + contrast + temporal motion + upper-frame bias
function detectFaceFallbackCV(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  prevPixels: Uint8ClampedArray | null
): { detection: RawDetection | null; pixels: Uint8ClampedArray } {
  const img = ctx.getImageData(0, 0, width, height);
  const data = img.data;

  const gridCols = 16;
  const gridRows = 9;
  const cellScores = new Float32Array(gridCols * gridRows);
  const cellSkinCounts = new Float32Array(gridCols * gridRows);

  for (let y = 0; y < height; y++) {
    const gy = Math.min(gridRows - 1, Math.floor((y / height) * gridRows));
    // Faces are usually in upper/middle 75% of frame
    const verticalBias = y < height * 0.72 ? 1.25 : 0.65;

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Convert RGB -> YCbCr for lighting-resilient skin detection
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

      const isSkin =
        lum > 40 &&
        lum < 245 &&
        cb >= 77 &&
        cb <= 127 &&
        cr >= 133 &&
        cr <= 175 &&
        r > g &&
        r > b;

      let motion = 0;
      if (prevPixels) {
        motion =
          (Math.abs(r - prevPixels[idx]) +
            Math.abs(g - prevPixels[idx + 1]) +
            Math.abs(b - prevPixels[idx + 2])) /
          765;
      }

      const gx = Math.min(gridCols - 1, Math.floor((x / width) * gridCols));
      const cellIdx = gy * gridCols + gx;

      if (isSkin) {
        cellSkinCounts[cellIdx] += 1;
        cellScores[cellIdx] += (1.8 + motion * 4.0) * verticalBias;
      } else if (motion > 0.08) {
        cellScores[cellIdx] += motion * 1.4 * verticalBias;
      }
    }
  }

  // Smooth 3x3 neighborhood to find strongest head cluster
  let bestScore = 0;
  let bestGx = Math.floor(gridCols / 2);
  let bestGy = Math.floor(gridRows * 0.38);

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      let sum = 0;
      let skinSum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx >= 0 && nx < gridCols && ny >= 0 && ny < gridRows) {
            const weight = dx === 0 && dy === 0 ? 1.5 : 0.75;
            const cIdx = ny * gridCols + nx;
            sum += cellScores[cIdx] * weight;
            skinSum += cellSkinCounts[cIdx];
          }
        }
      }
      if (sum > bestScore && skinSum > 18) {
        bestScore = sum;
        bestGx = gx;
        bestGy = gy;
      }
    }
  }

  const pixelsCopy = new Uint8ClampedArray(data);
  if (bestScore <= 25) {
    return { detection: null, pixels: pixelsCopy };
  }

  return {
    detection: {
      x: Math.min(0.88, Math.max(0.12, (bestGx + 0.5) / gridCols)),
      y: Math.min(0.82, Math.max(0.16, (bestGy + 0.5) / gridRows)),
      w: 0.18,
      h: 0.28,
      confidence: Math.min(0.82, 0.45 + bestScore / 2500),
    },
    pixels: pixelsCopy,
  };
}

function pickPrimaryFace(
  detections: RawDetection[],
  prevPos: { x: number; y: number } | null
): RawDetection | null {
  if (detections.length === 0) return null;
  if (detections.length === 1) return detections[0];

  let best = detections[0];
  let bestRank = -Infinity;

  for (const det of detections) {
    const areaScore = Math.min(1, det.w * det.h * 8);
    const centerDist = Math.hypot(det.x - 0.5, det.y - 0.42);
    const centralityScore = Math.max(0, 1 - centerDist * 1.4);
    const continuityScore = prevPos
      ? Math.max(0, 1 - Math.hypot(det.x - prevPos.x, det.y - prevPos.y) * 2.2)
      : 0.5;

    const rank =
      det.confidence * 0.3 +
      areaScore * 0.3 +
      centralityScore * 0.15 +
      continuityScore * 0.25;

    if (rank > bestRank) {
      bestRank = rank;
      best = det;
    }
  }

  return best;
}

export function smoothFaceKeyframes(
  raw: FaceKeyframe[],
  smoothingPct: number
): FaceKeyframe[] {
  if (raw.length === 0) return [];
  const alpha = Math.max(0.12, Math.min(0.95, 1 - (smoothingPct / 100) * 0.85));
  const deadzone = 0.012;

  const out: FaceKeyframe[] = [{ ...raw[0] }];
  let curX = raw[0].x;
  let curY = raw[0].y;
  let curW = raw[0].w;
  let curH = raw[0].h;

  for (let i = 1; i < raw.length; i++) {
    const next = raw[i];
    const dist = Math.hypot(next.x - curX, next.y - curY);

    if (dist > 0.28) {
      // Scene cut: snap cleanly to new speaker position instead of slow laggy pan
      curX = next.x;
      curY = next.y;
      curW = next.w;
      curH = next.h;
    } else if (dist > deadzone) {
      curX = curX + (next.x - curX) * alpha;
      curY = curY + (next.y - curY) * alpha;
      curW = curW + (next.w - curW) * alpha;
      curH = curH + (next.h - curH) * alpha;
    }

    out.push({
      time: next.time,
      x: Number(curX.toFixed(4)),
      y: Number(curY.toFixed(4)),
      w: Number(curW.toFixed(4)),
      h: Number(curH.toFixed(4)),
      confidence: next.confidence,
    });
  }

  return out;
}

export function interpolateFaceAtTime(
  keyframes: FaceKeyframe[],
  time: number
): FaceKeyframe | null {
  if (!keyframes || keyframes.length === 0) return null;
  if (keyframes.length === 1 || time <= keyframes[0].time) {
    return keyframes[0];
  }
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) return last;

  // Binary search for bracketing keyframes
  let lo = 0;
  let hi = keyframes.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].time <= time) lo = mid;
    else hi = mid;
  }

  const a = keyframes[lo];
  const b = keyframes[hi];
  const span = Math.max(0.0001, b.time - a.time);
  const t = Math.max(0, Math.min(1, (time - a.time) / span));

  // If jump between a and b is a hard camera cut, snap at midpoint instead of sliding across cut
  if (Math.hypot(b.x - a.x, b.y - a.y) > 0.28) {
    return t < 0.5 ? a : b;
  }

  // Smoothstep easing for cinematic camera glide
  const ease = t * t * (3 - 2 * t);
  return {
    time,
    x: a.x + (b.x - a.x) * ease,
    y: a.y + (b.y - a.y) * ease,
    w: a.w + (b.w - a.w) * ease,
    h: a.h + (b.h - a.h) * ease,
    confidence: a.confidence + (b.confidence - a.confidence) * ease,
  };
}

export function createDemoFaceKeyframes(start: number, end: number): FaceKeyframe[] {
  const frames: FaceKeyframe[] = [];
  const step = 0.5;
  for (let t = start; t <= end + 0.01; t += step) {
    frames.push({
      time: Number(t.toFixed(2)),
      x: Number((0.5 + Math.sin(t * 0.85) * 0.16).toFixed(4)),
      y: Number((0.44 + Math.cos(t * 0.7) * 0.04).toFixed(4)),
      w: 0.16,
      h: 0.28,
      confidence: 0.94,
    });
  }
  return frames;
}

export interface FaceTrackResult {
  keyframes: FaceKeyframe[];
  engineUsed: string;
  facesDetectedCount: number;
}

export async function trackFacesInVideo(params: {
  source: Blob | string;
  start: number;
  end: number;
  smoothing?: number;
  sampleFps?: number;
  maxSamples?: number;
  onProgress?: (pct: number, label: string) => void;
}): Promise<FaceTrackResult> {
  const {
    source,
    start,
    end,
    smoothing = 72,
    sampleFps = 2.5,
    maxSamples = 52,
    onProgress,
  } = params;

  onProgress?.(5, 'Inicializando detector facial local (MediaPipe BlazeFace)...');
  const mpDetector = await getMediaPipeFaceDetector();

  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
  const srcUrl = objectUrl || (source as string);

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.src = srcUrl;

  const sampleW = 320;
  const sampleH = 180;
  const canvas = document.createElement('canvas');
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let usedMediaPipe = Boolean(mpDetector);
  let facesDetectedCount = 0;
  const rawKeyframes: FaceKeyframe[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      const tm = window.setTimeout(() => reject(new Error('Tiempo agotado cargando video')), 12_000);
      video.onloadeddata = () => {
        window.clearTimeout(tm);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(tm);
        reject(new Error('No se pudo decodificar el video para seguimiento facial'));
      };
    });

    const dur = Math.max(0.5, video.duration || end);
    const safeStart = Math.max(0, Math.min(dur - 0.2, start));
    const safeEnd = Math.max(safeStart + 0.2, Math.min(dur, end));
    const span = safeEnd - safeStart;

    const totalSamples = Math.max(6, Math.min(maxSamples, Math.round(span * sampleFps)));
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const drawH = Math.max(120, Math.round((vh / vw) * sampleW));
    canvas.height = drawH;

    let prevPos: { x: number; y: number } | null = null;
    let prevPixels: Uint8ClampedArray | null = null;

    for (let i = 0; i < totalSamples; i++) {
      const targetTime = safeStart + (i / Math.max(1, totalSamples - 1)) * span;
      video.currentTime = Math.min(dur - 0.05, targetTime);

      await new Promise<void>((resolve) => {
        const tm = window.setTimeout(resolve, 650);
        video.onseeked = () => {
          window.clearTimeout(tm);
          resolve();
        };
      });

      if (!ctx) continue;
      ctx.drawImage(video, 0, 0, sampleW, drawH);

      let chosen: RawDetection | null = null;

      if (mpDetector && usedMediaPipe) {
        try {
          const res = mpDetector.detect(canvas);
          const mapped: RawDetection[] = (res.detections || [])
            .map((d) => {
              const bb = d.boundingBox;
              if (!bb) return null;
              return {
                x: Math.max(0.05, Math.min(0.95, (bb.originX + bb.width / 2) / sampleW)),
                y: Math.max(0.05, Math.min(0.95, (bb.originY + bb.height / 2) / drawH)),
                w: Math.max(0.05, Math.min(0.8, bb.width / sampleW)),
                h: Math.max(0.05, Math.min(0.8, bb.height / drawH)),
                confidence: d.categories?.[0]?.score ?? 0.75,
              };
            })
            .filter((x): x is RawDetection => x !== null);

          chosen = pickPrimaryFace(mapped, prevPos);
        } catch {
          usedMediaPipe = false;
        }
      }

      if (!chosen) {
        const fb = detectFaceFallbackCV(ctx, sampleW, drawH, prevPixels);
        prevPixels = fb.pixels;
        if (!usedMediaPipe) {
          chosen = fb.detection;
        }
      }

      if (chosen) {
        facesDetectedCount++;
        prevPos = { x: chosen.x, y: chosen.y };
        rawKeyframes.push({
          time: Number(targetTime.toFixed(2)),
          x: Number(chosen.x.toFixed(4)),
          y: Number(chosen.y.toFixed(4)),
          w: Number(chosen.w.toFixed(4)),
          h: Number(chosen.h.toFixed(4)),
          confidence: Number(chosen.confidence.toFixed(2)),
        });
      } else if (prevPos) {
        // Hold last tracked position briefly during brief head turns
        rawKeyframes.push({
          time: Number(targetTime.toFixed(2)),
          x: prevPos.x,
          y: prevPos.y,
          w: 0.16,
          h: 0.25,
          confidence: 0.35,
        });
      } else {
        rawKeyframes.push({
          time: Number(targetTime.toFixed(2)),
          x: 0.5,
          y: 0.38,
          w: 0.16,
          h: 0.25,
          confidence: 0.2,
        });
      }

      const pct = Math.round(10 + ((i + 1) / totalSamples) * 85);
      onProgress?.(
        pct,
        `Rastreando rostro en fotograma ${i + 1} de ${totalSamples}...`
      );
    }
  } finally {
    video.removeAttribute('src');
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }

  const smoothed = smoothFaceKeyframes(rawKeyframes, smoothing);
  onProgress?.(100, 'Seguimiento de rostro completado.');

  return {
    keyframes: smoothed,
    engineUsed: usedMediaPipe
      ? 'MediaPipe BlazeFace (Local)'
      : 'Rastreador CV YCbCr + Movimiento (Offline)',
    facesDetectedCount,
  };
}
