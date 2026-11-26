/**
 * N4 — «Terminar mi clip»: acabado automático OPCIONAL al exportar (servidor local).
 *
 * Ayudantes puros y comprobables para:
 *  - Zoom suave (punch-in) en los momentos de énfasis: construye la expresión
 *    de zoom variable en el tiempo y el filtro crop+scale de FFmpeg. Los
 *    momentos llegan ya calculados por el editor (en tiempos de SALIDA) a
 *    partir de los subtítulos y, si los hay, de los tramos con cara detectada.
 *  - Música de fondo con «ducking»: la música que la usuaria cargó desde su
 *    PC (audio.bin del trabajo de exportación) baja sola cuando hay voz,
 *    con `sidechaincompress` usando la voz como señal de control.
 *  - Efecto de sonido sutil en los cambios de escena/cortes: un «pop»
 *    sintetizado con el propio FFmpeg (seno breve con fundidos), sin
 *    archivos de audio externos ni licencias dudosas.
 *  - Resaltado de palabras clave en los subtítulos: se reutiliza la sintaxis
 *    *palabra* que ya entiende el constructor ASS (ver assBuilder.ts); aquí
 *    solo se normaliza la lista de palabras que llega del editor.
 *
 * Todo es local y NO destructivo: solo se aplica en la exportación FFmpeg
 * del servidor; el proyecto y el medio original nunca se modifican. Si la
 * función está desactivada, estos ayudantes no producen ningún filtro.
 */

export interface FinishZoomMoment {
  /** Segundos en la línea de tiempo de SALIDA (tras recortes y velocidad). */
  start: number;
  end: number;
}

export interface FinishClipOptions {
  enabled: boolean;
  zoomEnabled: boolean;
  /** Intensidad del punch-in, 100..140 (porcentaje; 115 = zoom ×1.15). */
  zoomIntensity: number;
  zoomMoments: FinishZoomMoment[];
  duckingEnabled: boolean;
  /** Cuánto baja la música cuando hay voz, 0..100. */
  duckingAmount: number;
  sfxEnabled: boolean;
  /** Volumen del efecto de sonido, 0..100. */
  sfxVolume: number;
  /** Instantes de SALIDA donde suena el efecto (cortes/cambios de escena). */
  sfxTimes: number[];
  keywordHighlightEnabled: boolean;
  /** Palabras clave a resaltar en los subtítulos (texto libre del editor). */
  keywords: string[];
}

export const MAX_ZOOM_MOMENTS = 24;
export const MAX_SFX_TIMES = 16;

function clamp(n: number, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}

/** Normaliza la lista de palabras clave que llega en el cuerpo de la petición. */
export function normalizeKeywordList(raw: unknown): string[] {
  const parts: string[] = [];
  if (typeof raw === 'string') {
    parts.push(...raw.split(/[,\n;]+/g));
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') parts.push(...item.split(/[,\n;]+/g));
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
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

/** Normaliza las opciones de «Terminar mi clip» que llegan en la petición. */
export function normalizeFinishClipOptions(
  raw: (Partial<FinishClipOptions> & { keywords?: unknown }) | undefined | null
): FinishClipOptions {
  const r = raw || {};

  const momentsRaw = Array.isArray(r.zoomMoments) ? r.zoomMoments : [];
  const zoomMoments: FinishZoomMoment[] = [];
  for (const m of momentsRaw) {
    const start = Number((m as FinishZoomMoment)?.start);
    const end = Number((m as FinishZoomMoment)?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const s = Math.max(0, start);
    const e = Math.max(s + 0.1, end);
    if (e - s > 6) continue; // Un punch-in es breve; momentos largos se descartan.
    zoomMoments.push({ start: Number(s.toFixed(3)), end: Number(e.toFixed(3)) });
    if (zoomMoments.length >= MAX_ZOOM_MOMENTS) break;
  }
  zoomMoments.sort((a, b) => a.start - b.start);

  const timesRaw = Array.isArray(r.sfxTimes) ? r.sfxTimes : [];
  const sfxTimes: number[] = [];
  for (const t of timesRaw) {
    const v = Number(t);
    if (!Number.isFinite(v) || v < 0.05) continue;
    sfxTimes.push(Number(v.toFixed(3)));
    if (sfxTimes.length >= MAX_SFX_TIMES) break;
  }
  sfxTimes.sort((a, b) => a - b);

  return {
    enabled: Boolean(r.enabled),
    zoomEnabled: r.zoomEnabled !== false,
    zoomIntensity: clamp(r.zoomIntensity ?? 115, 100, 140, 115),
    zoomMoments,
    duckingEnabled: r.duckingEnabled !== false,
    duckingAmount: clamp(r.duckingAmount ?? 60, 0, 100, 60),
    sfxEnabled: Boolean(r.sfxEnabled),
    sfxVolume: clamp(r.sfxVolume ?? 35, 0, 100, 35),
    sfxTimes,
    keywordHighlightEnabled: r.keywordHighlightEnabled !== false,
    keywords: normalizeKeywordList(r.keywords),
  };
}

export interface KeywordCue {
  start: number;
  end: number;
  text: string;
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

/**
 * Envuelve las palabras clave de los subtítulos en *...* para que el
 * constructor ASS las pinte con el color de resaltado. Respeta los
 * resaltados que ya vinieran marcados en el texto.
 */
export function highlightKeywordsInCues<T extends KeywordCue>(
  cues: T[],
  keywords: string[]
): T[] {
  if (!keywords.length) return cues;
  const patterns = [...keywords]
    .sort((a, b) => b.length - a.length)
    .map((kw) => keywordPattern(kw));
  return cues.map((cue) => {
    const tokens = String(cue.text || '').split(/(\*[^*]+\*)/g);
    const parts = tokens.map((part) => {
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return part;
      let out = part;
      for (const re of patterns) {
        out = out.replace(re, '*$1*');
      }
      return out;
    });
    return { ...cue, text: parts.join('') };
  });
}

/** ¿Debe aplicarse el zoom de énfasis con estas opciones? */
export function finishZoomActive(opts: FinishClipOptions): boolean {
  return (
    opts.enabled &&
    opts.zoomEnabled &&
    opts.zoomIntensity > 101 &&
    opts.zoomMoments.length > 0
  );
}

/**
 * Expresión FFmpeg del factor de zoom en función del tiempo `t` (salida).
 * Cada momento aporta una «campana» triangular con rampas de 0.3 s para que
 * el punch-in entre y salga suave, sin saltos. La suma se limita a 1 para
 * que momentos solapados no disparen el zoom.
 */
export function buildZoomFactorExpression(opts: FinishClipOptions): string {
  const extra = (opts.zoomIntensity - 100) / 100;
  const bumps = opts.zoomMoments.map((m) => {
    const rampInStart = Math.max(0, m.start - 0.3);
    const rampInEnd = m.start + 0.3;
    const rampOutStart = m.end - 0.3;
    const rampOutEnd = m.end + 0.3;
    const up = `min(max((t-${fmt(rampInStart)})/${fmt(Math.max(0.05, rampInEnd - rampInStart))},0),1)`;
    const down = `min(max((${fmt(rampOutEnd)}-t)/${fmt(Math.max(0.05, rampOutEnd - rampOutStart))},0),1)`;
    return `min(${up},${down})`;
  });
  return `1+${fmt(extra)}*min(${bumps.join('+')},1)`;
}

/**
 * Filtro de zoom de énfasis para insertar sobre el vídeo ya encuadrado
 * (W×H). Recorta centrado con el factor variable y reescala al tamaño final.
 * Se aplica ANTES de los subtítulos para que el texto no se mueva.
 */
export function buildEmphasisZoomFilter(
  opts: FinishClipOptions,
  width: number,
  height: number,
  inputLabel: string,
  outputLabel: string
): string {
  const f = buildZoomFactorExpression(opts);
  return (
    `[${inputLabel}]crop=w='iw/(${f})':h='ih/(${f})':x='(iw-out_w)/2':y='(ih-out_h)/2',` +
    `scale=${width}:${height}[${outputLabel}]`
  );
}

/** ¿Debe aplicarse el ducking de la música con estas opciones? */
export function finishDuckingActive(opts: FinishClipOptions): boolean {
  return opts.enabled && opts.duckingEnabled && opts.duckingAmount > 0;
}

/**
 * Parámetros de sidechaincompress a partir de la cantidad de ducking (0..100):
 * más cantidad = umbral más bajo y ratio más alto (la música baja más).
 */
export function buildDuckingFilter(
  opts: FinishClipOptions,
  musicLabel: string,
  voiceKeyLabel: string,
  outputLabel: string
): string {
  const amount = clamp(opts.duckingAmount, 0, 100, 60) / 100;
  const threshold = (0.04 - amount * 0.03).toFixed(4); // 0.04 .. 0.01
  const ratio = Math.round(4 + amount * 12); // 4 .. 16
  return (
    `[${musicLabel}][${voiceKeyLabel}]sidechaincompress=` +
    `threshold=${threshold}:ratio=${ratio}:attack=20:release=320:makeup=1[${outputLabel}]`
  );
}

/** ¿Debe sonar el efecto de cambio de escena con estas opciones? */
export function finishSfxActive(opts: FinishClipOptions): boolean {
  return opts.enabled && opts.sfxEnabled && opts.sfxVolume > 0 && opts.sfxTimes.length > 0;
}

/**
 * Fuentes del efecto «pop» sutil: un seno grave muy breve (0.12 s) con
 * fundidos, retrasado a cada instante pedido y a volumen bajo. Se genera
 * con FFmpeg; no se usa ningún archivo de audio externo.
 * Devuelve los filtros fuente y las etiquetas listas para mezclar.
 */
export function buildSfxSourceFilters(
  opts: FinishClipOptions,
  labelPrefix = 'sfx'
): { filters: string[]; labels: string[] } {
  const filters: string[] = [];
  const labels: string[] = [];
  const vol = (clamp(opts.sfxVolume, 0, 100, 35) / 100) * 0.5;
  opts.sfxTimes.forEach((time, idx) => {
    const label = `${labelPrefix}${idx}`;
    const delayMs = Math.max(0, Math.round(time * 1000));
    filters.push(
      `sine=frequency=150:duration=0.12,afade=t=in:st=0:d=0.012,` +
        `afade=t=out:st=0.05:d=0.07,volume=${fmt(vol)},adelay=${delayMs}:all=1[${label}]`
    );
    labels.push(`[${label}]`);
  });
  return { filters, labels };
}
