/**
 * N3 — Limpieza automática de audio en un clic (servidor local).
 *
 * Ayudantes puros y comprobables para:
 *  - Interpretar la salida de `silencedetect` de FFmpeg.
 *  - Interpretar las mediciones de `loudnorm` (primera pasada, print_format=json).
 *  - Construir los filtros de audio de limpieza (loudnorm + afftdn) que se
 *    aplican SOLO al exportar: el medio original nunca se modifica.
 *
 * Todo es local: sin nube y sin APIs de pago.
 */

export interface SilenceRange {
  start: number;
  end: number;
  duration: number;
}

export interface LoudnormMeasured {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

export interface AudioCleanupOptions {
  enabled: boolean;
  normalize: boolean;
  denoise: boolean;
  /** 0..100 (interfaz) */
  denoiseStrength: number;
  measured: LoudnormMeasured | null;
}

const NUM = '(-?\\d+(?:\\.\\d+)?)';

/** Extrae los rangos de silencio de la salida de stderr de silencedetect. */
export function parseSilenceDetectOutput(stderr: string): SilenceRange[] {
  const ranges: SilenceRange[] = [];
  if (!stderr) return ranges;
  const startRe = new RegExp(`silence_start:\\s*${NUM}`, 'g');
  const endRe = new RegExp(`silence_end:\\s*${NUM}\\s*\\|\\s*silence_duration:\\s*${NUM}`, 'g');

  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(stderr)) !== null) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) starts.push(v);
  }
  let idx = 0;
  while ((m = endRe.exec(stderr)) !== null) {
    const end = Number(m[1]);
    const duration = Number(m[2]);
    const start = idx < starts.length ? starts[idx] : Math.max(0, end - duration);
    idx++;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      ranges.push({
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        duration: Number((Number.isFinite(duration) ? duration : end - start).toFixed(3)),
      });
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** Duración total (segundos) desde la línea `Duration: HH:MM:SS.xx` de FFmpeg. */
export function parseFfmpegDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr || '');
  if (!m) return null;
  const total = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Extrae el bloque JSON de medición de loudnorm (print_format=json).
 * FFmpeg lo imprime al final de stderr entre corchetes con claves input_*.
 */
export function parseLoudnormMeasured(stderr: string): LoudnormMeasured | null {
  if (!stderr) return null;
  const blocks = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks || blocks.length === 0) return null;
  try {
    const raw = JSON.parse(blocks[blocks.length - 1]) as Record<string, string>;
    const measured: LoudnormMeasured = {
      inputI: Number(raw.input_i),
      inputTp: Number(raw.input_tp),
      inputLra: Number(raw.input_lra),
      inputThresh: Number(raw.input_thresh),
      targetOffset: Number(raw.target_offset),
    };
    if (
      Number.isFinite(measured.inputI) &&
      Number.isFinite(measured.inputTp) &&
      Number.isFinite(measured.inputLra) &&
      Number.isFinite(measured.inputThresh) &&
      Number.isFinite(measured.targetOffset)
    ) {
      return measured;
    }
  } catch {
    // Sin medición válida: se usará loudnorm de una pasada.
  }
  return null;
}

function fmt(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/**
 * Filtro loudnorm. Con medición previa usa el modo de dos pasadas
 * (linear=true cuando el rango lo permite); sin medición, una pasada.
 * Objetivo: -14 LUFS (estándar de Shorts/TikTok/Reels), TP -1.5, LRA 11.
 */
export function buildLoudnormFilter(measured?: LoudnormMeasured | null): string {
  const base = 'loudnorm=I=-14:TP=-1.5:LRA=11';
  if (!measured) return base;
  return (
    `${base}:measured_I=${fmt(measured.inputI)}:measured_TP=${fmt(measured.inputTp)}` +
    `:measured_LRA=${fmt(measured.inputLra)}:measured_thresh=${fmt(measured.inputThresh)}` +
    `:offset=${fmt(measured.targetOffset)}:linear=true`
  );
}

/**
 * Filtro de reducción ligera de ruido (afftdn).
 * strength 0..100 → noise floor entre -32 dB (muy ligero) y -20 dB (fuerte).
 */
export function buildDenoiseFilter(strength: number): string {
  const s = Math.max(0, Math.min(100, Number.isFinite(strength) ? strength : 40));
  const nf = -32 + (s / 100) * 12;
  return `afftdn=nf=${fmt(nf)}`;
}

/** Normaliza las opciones de limpieza que llegan en el cuerpo de la petición. */
export function normalizeAudioCleanupOptions(
  raw: Partial<AudioCleanupOptions> | undefined | null
): AudioCleanupOptions {
  const r = raw || {};
  const measuredRaw = (r as { measured?: Partial<LoudnormMeasured> | null }).measured;
  let measured: LoudnormMeasured | null = null;
  if (measuredRaw) {
    const cand: LoudnormMeasured = {
      inputI: Number(measuredRaw.inputI),
      inputTp: Number(measuredRaw.inputTp),
      inputLra: Number(measuredRaw.inputLra),
      inputThresh: Number(measuredRaw.inputThresh),
      targetOffset: Number(measuredRaw.targetOffset),
    };
    if (
      Number.isFinite(cand.inputI) &&
      Number.isFinite(cand.inputTp) &&
      Number.isFinite(cand.inputLra) &&
      Number.isFinite(cand.inputThresh) &&
      Number.isFinite(cand.targetOffset)
    ) {
      measured = cand;
    }
  }
  return {
    enabled: Boolean(r.enabled),
    normalize: r.normalize !== false,
    denoise: Boolean(r.denoise),
    denoiseStrength: Math.max(
      0,
      Math.min(100, Number.isFinite(Number(r.denoiseStrength)) ? Number(r.denoiseStrength) : 40)
    ),
    measured,
  };
}

/**
 * Cadena de filtros de limpieza para insertar en la pista de voz ya
 * recortada/concatenada. Orden: primero quitar ruido, después nivelar
 * (loudnorm al final para que mida sobre la señal ya limpia).
 */
export function buildAudioCleanupFilters(opts: AudioCleanupOptions): string[] {
  if (!opts.enabled) return [];
  const filters: string[] = [];
  if (opts.denoise) filters.push(buildDenoiseFilter(opts.denoiseStrength));
  if (opts.normalize) {
    filters.push(buildLoudnormFilter(opts.measured));
    // loudnorm trabaja a 192 kHz: volvemos a 48 kHz para el AAC final.
    filters.push('aresample=48000');
  }
  return filters;
}
