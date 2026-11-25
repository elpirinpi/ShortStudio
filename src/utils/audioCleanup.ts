/**
 * N3 — Limpieza automática de audio en un clic (cliente).
 *
 * Funciones puras para:
 *  - Detectar muletillas en la transcripción de Whisper (palabras con tiempos).
 *  - Convertir los silencios detectados por el servidor (FFmpeg silencedetect)
 *    en segmentos de voz, y restar de ellos los cortes aceptados (muletillas).
 *  - Pedir el análisis al servidor local (`/api/media-job/:jobId/audio-cleanup-analyze`).
 *
 * Todo es NO destructivo: el resultado son ajustes del editor
 * (segmentos y marcas) que la usuaria puede revisar, desactivar o deshacer.
 * El archivo original nunca se toca; los filtros se aplican solo al exportar.
 */
import type { FillerMark, LoudnormMeasuredState, SpeechSegment, TranscriptSegment } from '../types/editor';

export const DEFAULT_FILLER_WORDS_TEXT = 'eh, mmm, em, este, o sea, es decir';

/** Normaliza una palabra para comparar: minúsculas, sin acentos ni puntuación. */
export function normalizeWordText(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
}

/** Convierte el texto configurable («eh, o sea, este») en lista de muletillas. */
export function parseFillerList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (text || '').split(',')) {
    const norm = part
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((w) => normalizeWordText(w))
      .filter(Boolean)
      .join(' ');
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  // Las frases (2+ palabras) primero, para que «o sea» gane a «sea» suelta.
  return out.sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length);
}

interface TimedWord {
  start: number;
  end: number;
  norm: string;
  text: string;
}

/**
 * Detecta muletillas en los segmentos de transcripción que traen palabras
 * con tiempos (Whisper local). Devuelve marcas sugeridas, todas activadas;
 * la usuaria puede desactivar cada una antes de exportar.
 */
export function detectFillerMarks(
  transcript: TranscriptSegment[] | null | undefined,
  fillerText: string
): FillerMark[] {
  const fillers = parseFillerList(fillerText);
  if (!transcript || fillers.length === 0) return [];

  const words: TimedWord[] = [];
  for (const seg of transcript) {
    if (!Array.isArray(seg.words)) continue;
    for (const w of seg.words) {
      const norm = normalizeWordText(w.text);
      if (!norm) continue;
      if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end <= w.start) continue;
      words.push({ start: w.start, end: w.end, norm, text: w.text });
    }
  }
  words.sort((a, b) => a.start - b.start);

  const marks: FillerMark[] = [];
  let i = 0;
  while (i < words.length) {
    let matched: { len: number; label: string } | null = null;
    for (const filler of fillers) {
      const parts = filler.split(' ');
      if (i + parts.length > words.length) continue;
      let ok = true;
      for (let k = 0; k < parts.length; k++) {
        if (words[i + k].norm !== parts[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matched = { len: parts.length, label: filler };
        break;
      }
    }
    if (matched) {
      const first = words[i];
      const last = words[i + matched.len - 1];
      marks.push({
        start: Number(first.start.toFixed(3)),
        end: Number(last.end.toFixed(3)),
        text: matched.label,
        enabled: true,
      });
      i += matched.len;
    } else {
      i += 1;
    }
  }
  return marks;
}

/**
 * Resta rangos de corte (muletillas aceptadas) de los segmentos de voz.
 * Los trozos resultantes más cortos que `minSegSec` se descartan.
 */
export function subtractCutsFromSegments(
  segments: SpeechSegment[],
  cuts: Array<{ start: number; end: number }>,
  minSegSec = 0.12
): SpeechSegment[] {
  const validCuts = cuts
    .map((c) => ({ start: Number(c.start), end: Number(c.end) }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  if (validCuts.length === 0) return segments.map((s) => ({ ...s }));

  const out: SpeechSegment[] = [];
  for (const seg of segments) {
    let pieces: SpeechSegment[] = [{ start: seg.start, end: seg.end }];
    for (const cut of validCuts) {
      const next: SpeechSegment[] = [];
      for (const piece of pieces) {
        if (cut.end <= piece.start || cut.start >= piece.end) {
          next.push(piece);
          continue;
        }
        if (cut.start > piece.start) {
          next.push({ start: piece.start, end: Math.min(cut.start, piece.end) });
        }
        if (cut.end < piece.end) {
          next.push({ start: Math.max(cut.end, piece.start), end: piece.end });
        }
      }
      pieces = next;
    }
    for (const piece of pieces) {
      if (piece.end - piece.start >= minSegSec) {
        out.push({
          start: Number(piece.start.toFixed(3)),
          end: Number(piece.end.toFixed(3)),
        });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Convierte los silencios del servidor en segmentos de voz dentro del rango
 * [rangeStart, rangeEnd], conservando `keepSec` de respiro a cada lado y
 * descartando silencios más cortos que `minSilenceSec`.
 */
export function buildSpeechSegmentsFromSilences(
  silences: Array<{ start: number; end: number }>,
  rangeStart: number,
  rangeEnd: number,
  opts: { minSilenceSec?: number; keepSec?: number } = {}
): SpeechSegment[] {
  const minSilenceSec = opts.minSilenceSec ?? 0.45;
  const keepSec = opts.keepSec ?? 0.09;
  const start = Math.max(0, rangeStart);
  const end = Math.max(start + 0.1, rangeEnd);

  const cuts = silences
    .map((s) => ({
      start: Math.max(start, Number(s.start) + keepSec),
      end: Math.min(end, Number(s.end) - keepSec),
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end - s.start >= minSilenceSec - keepSec * 2 && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  if (cuts.length === 0) return [{ start, end }];

  const segments: SpeechSegment[] = [];
  let cursor = start;
  for (const cut of cuts) {
    if (cut.start - cursor >= 0.08) segments.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (end - cursor >= 0.08) segments.push({ start: cursor, end });
  if (segments.length === 0) return [{ start, end }];
  return segments.map((s) => ({
    start: Number(s.start.toFixed(3)),
    end: Number(s.end.toFixed(3)),
  }));
}

export interface ServerCleanupAnalysis {
  durationSec: number | null;
  silences: Array<{ start: number; end: number; duration: number }>;
  loudnorm: LoudnormMeasuredState | null;
}

async function uploadBlobInChunks(blob: Blob, jobId: string): Promise<boolean> {
  const chunkBytes = 12 * 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += chunkBytes) {
    const chunk = blob.slice(offset, Math.min(blob.size, offset + chunkBytes));
    const upRes = await fetch(`/api/media-job/${jobId}/append?part=video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chunk,
    });
    if (!upRes.ok) return false;
  }
  return true;
}

/**
 * Análisis de limpieza en el servidor local: sube el medio por el mismo
 * canal de trabajos que usa la extracción de audio y pide silencedetect +
 * medición loudnorm. Devuelve null si el servidor no responde (la interfaz
 * cae entonces a la detección por energía que ya existía).
 */
export async function analyzeAudioCleanupOnServer(
  source: Blob | string,
  opts: { thresholdDb?: number; minSilenceSec?: number }
): Promise<ServerCleanupAnalysis | null> {
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
    const { jobId } = (await initRes.json()) as { jobId?: string };
    if (!jobId) return null;
    if (!(await uploadBlobInChunks(blob, jobId))) return null;

    const res = await fetch(`/api/media-job/${jobId}/audio-cleanup-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thresholdDb: opts.thresholdDb ?? -34,
        minSilenceSec: opts.minSilenceSec ?? 0.45,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerCleanupAnalysis;
    if (!data || !Array.isArray(data.silences)) return null;
    return data;
  } catch {
    return null;
  }
}
