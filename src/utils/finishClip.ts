/**
 * N4 — «Terminar mi clip» (cliente).
 *
 * Ayudantes puros para preparar la exportación FFmpeg del servidor:
 *  - Calcular los momentos de énfasis (zoom suave) en tiempos de SALIDA a
 *    partir de los subtítulos que mencionan palabras clave y de los tramos
 *    con cara detectada (seguimiento facial ya calculado por el editor).
 *  - Calcular los instantes de efecto de sonido: los cortes entre bloques
 *    de voz (cambios de escena del montaje resultante).
 *
 * El resaltado de palabras clave en los subtítulos lo aplica el servidor
 * (server/finishClip.ts) con la lista que viaja en los ajustes.
 *
 * Nada de esto modifica el proyecto: se calcula sobre copias al exportar.
 */
import {
  EditorSettings,
  SpeechSegment,
  SubtitleCue,
} from '../types/editor';
import {
  getEffectiveSpeechSegments,
  sourceTimeToOutputTime,
} from './clipTiming';

export interface FinishZoomMoment {
  start: number;
  end: number;
}

const MAX_MOMENTS = 6;
const MOMENT_DURATION = 1.1;
const MIN_GAP = 2.2;

/** Lista de palabras clave desde el texto libre de ajustes (comas o líneas). */
export function parseKeywordList(text: string | undefined | null): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(text).split(/[,\n;]+/g)) {
    const word = part.replace(/\*/g, '').trim();
    if (word.length < 2 || word.length > 40) continue;
    const key = word.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= 24) break;
  }
  return out;
}

const ACCENT_GROUPS: Record<string, string> = {
  a: 'aáàäâ',
  e: 'eéèëê',
  i: 'iíìïî',
  o: 'oóòöô',
  u: 'uúùüû',
  n: 'nñ',
  c: 'cç',
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Patrón regex de una palabra clave tolerante a acentos y mayúsculas. */
function keywordPattern(keyword: string): RegExp {
  const body = Array.from(keyword)
    .map((ch) => {
      const lower = ch.toLocaleLowerCase('es');
      const group = ACCENT_GROUPS[lower];
      if (group) return `[${group}]`;
      return escapeRegExp(ch);
    })
    .join('');
  return new RegExp(`(?<![\\p{L}\\p{N}])(${body})(?![\\p{L}\\p{N}])`, 'giu');
}

/** ¿El texto contiene alguna palabra clave completa? */
export function cueContainsKeyword(text: string, keywords: string[]): boolean {
  const plain = String(text || '').replace(/\*/g, '');
  return keywords.some((kw) => keywordPattern(kw).test(plain));
}

/**
 * Momentos de énfasis en tiempos de SALIDA: inicio de los subtítulos que
 * mencionan palabras clave y apariciones de cara tras una ausencia.
 */
export function computeFinishZoomMoments(
  settings: EditorSettings,
  subtitles: SubtitleCue[]
): FinishZoomMoment[] {
  const segments: SpeechSegment[] = getEffectiveSpeechSegments(settings);
  const speed = Math.max(0.25, Math.min(4, Number(settings.speed || 1)));
  const keywords = parseKeywordList(settings.finishKeywords);
  const candidates: number[] = [];

  for (const cue of subtitles || []) {
    if (cue.end <= settings.trimStart || cue.start >= settings.trimEnd) continue;
    if (keywords.length > 0 && cueContainsKeyword(cue.text, keywords)) {
      candidates.push(sourceTimeToOutputTime(cue.start, segments, speed));
    }
  }

  const keyframes = Array.isArray(settings.faceKeyframes) ? settings.faceKeyframes : [];
  let lastFaceTime = -Infinity;
  for (const kf of keyframes) {
    if (!kf || !Number.isFinite(kf.time)) continue;
    if (kf.time - lastFaceTime > 1.6) {
      // La cara (re)aparece tras una ausencia: momento de énfasis.
      const out = sourceTimeToOutputTime(kf.time, segments, speed);
      candidates.push(out);
    }
    lastFaceTime = Math.max(lastFaceTime, kf.time);
  }

  candidates.sort((a, b) => a - b);
  const moments: FinishZoomMoment[] = [];
  for (const start of candidates) {
    if (start < 0.4) continue;
    const prev = moments[moments.length - 1];
    if (prev && start - prev.start < MIN_GAP) continue;
    moments.push({
      start: Number(start.toFixed(3)),
      end: Number((start + MOMENT_DURATION).toFixed(3)),
    });
    if (moments.length >= MAX_MOMENTS) break;
  }
  return moments;
}

/**
 * Instantes de efecto de sonido en tiempos de SALIDA: los cortes entre
 * bloques de voz del montaje (los «cambios de escena» audibles).
 */
export function computeFinishSfxTimes(settings: EditorSettings): number[] {
  const segments = getEffectiveSpeechSegments(settings);
  const speed = Math.max(0.25, Math.min(4, Number(settings.speed || 1)));
  const times: number[] = [];
  for (let i = 1; i < segments.length; i++) {
    const out = sourceTimeToOutputTime(segments[i].start, segments, speed);
    if (out >= 0.15) times.push(Number(out.toFixed(3)));
    if (times.length >= 16) break;
  }
  return times;
}
