import { AudioProfile, EditorSettings, SpeechSegment, SubtitleCue } from '../types/editor';

export function getEffectiveSpeechSegments(settings: {
  trimStart: number;
  trimEnd: number;
  silenceCutEnabled?: boolean;
  speechSegments?: SpeechSegment[];
}): SpeechSegment[] {
  const trimStart = Math.max(0, Number(settings.trimStart || 0));
  const trimEnd = Math.max(trimStart + 0.1, Number(settings.trimEnd || trimStart + 0.1));

  if (
    !settings.silenceCutEnabled ||
    !Array.isArray(settings.speechSegments) ||
    settings.speechSegments.length === 0
  ) {
    return [{ start: trimStart, end: trimEnd }];
  }

  const clamped: SpeechSegment[] = [];
  for (const seg of settings.speechSegments) {
    const s = Math.max(trimStart, Number(seg.start));
    const e = Math.min(trimEnd, Number(seg.end));
    if (Number.isFinite(s) && Number.isFinite(e) && e - s >= 0.08) {
      clamped.push({ start: Number(s.toFixed(3)), end: Number(e.toFixed(3)) });
    }
  }

  if (clamped.length === 0) {
    return [{ start: trimStart, end: trimEnd }];
  }

  clamped.sort((a, b) => a.start - b.start);
  const merged: SpeechSegment[] = [clamped[0]];
  for (let i = 1; i < clamped.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = clamped[i];
    if (cur.start <= prev.end + 0.04) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

/**
 * Merges smallest silent gaps so segment count never exceeds maxSegments
 * (prevents excessively long FFmpeg filtergraph command strings on Windows).
 */
export function capSpeechSegments(
  segments: SpeechSegment[],
  maxSegments = 42
): SpeechSegment[] {
  if (segments.length <= maxSegments) return segments;
  const working = segments.map((s) => ({ ...s }));
  while (working.length > maxSegments) {
    let minGapIdx = 0;
    let minGap = Infinity;
    for (let i = 0; i < working.length - 1; i++) {
      const gap = working[i + 1].start - working[i].end;
      if (gap < minGap) {
        minGap = gap;
        minGapIdx = i;
      }
    }
    working[minGapIdx].end = working[minGapIdx + 1].end;
    working.splice(minGapIdx + 1, 1);
  }
  return working;
}

export function getEffectiveSourceDuration(settings: {
  trimStart: number;
  trimEnd: number;
  silenceCutEnabled?: boolean;
  speechSegments?: SpeechSegment[];
}): number {
  const segs = getEffectiveSpeechSegments(settings);
  const sum = segs.reduce((acc, seg) => acc + Math.max(0, seg.end - seg.start), 0);
  return Math.max(0.1, sum);
}

export function getEffectiveOutputDuration(settings: {
  trimStart: number;
  trimEnd: number;
  speed: number;
  silenceCutEnabled?: boolean;
  speechSegments?: SpeechSegment[];
}): number {
  const speed = Math.max(0.25, Math.min(4, Number(settings.speed || 1)));
  return Math.max(0.1, getEffectiveSourceDuration(settings) / speed);
}

export function sourceTimeToOutputTime(
  srcTime: number,
  segments: SpeechSegment[],
  speed = 1
): number {
  const spd = Math.max(0.25, Math.min(4, speed || 1));
  if (!segments.length) return 0;

  let accSrc = 0;
  for (const seg of segments) {
    if (srcTime <= seg.start) {
      return accSrc / spd;
    }
    if (srcTime <= seg.end) {
      return (accSrc + (srcTime - seg.start)) / spd;
    }
    accSrc += seg.end - seg.start;
  }
  return accSrc / spd;
}

export function outputTimeToSourceTime(
  outTime: number,
  segments: SpeechSegment[],
  speed = 1
): number {
  const spd = Math.max(0.25, Math.min(4, speed || 1));
  if (!segments.length) return 0;
  const targetSrcElapsed = Math.max(0, outTime * spd);
  let acc = 0;
  for (const seg of segments) {
    const len = seg.end - seg.start;
    if (targetSrcElapsed <= acc + len) {
      return seg.start + (targetSrcElapsed - acc);
    }
    acc += len;
  }
  return segments[segments.length - 1].end;
}

export function remapSubtitlesToOutputTimeline(
  cues: SubtitleCue[],
  segments: SpeechSegment[],
  speed = 1
): Array<{ start: number; end: number; text: string; id: number }> {
  const spd = Math.max(0.25, Math.min(4, speed || 1));
  const out: Array<{ start: number; end: number; text: string; id: number }> = [];

  for (const cue of cues) {
    let bestStart: number | null = null;
    let bestEnd: number | null = null;
    let accSrc = 0;

    for (const seg of segments) {
      const ovStart = Math.max(cue.start, seg.start);
      const ovEnd = Math.min(cue.end, seg.end);
      if (ovEnd > ovStart + 0.02) {
        const sOut = (accSrc + (ovStart - seg.start)) / spd;
        const eOut = (accSrc + (ovEnd - seg.start)) / spd;
        if (bestStart === null) bestStart = sOut;
        bestEnd = eOut;
      }
      accSrc += seg.end - seg.start;
    }

    if (bestStart !== null && bestEnd !== null && bestEnd > bestStart + 0.04) {
      out.push({
        id: cue.id,
        start: Number(bestStart.toFixed(3)),
        end: Number(bestEnd.toFixed(3)),
        text: cue.text,
      });
    }
  }

  return out;
}

export function computeSpeechSegmentsFromEnergy(
  energy20Hz: number[],
  sampleRateHz: number,
  durationSec: number,
  rangeStart: number,
  rangeEnd: number,
  opts?: {
    thresholdDb?: number;
    minSilenceSec?: number;
    paddingSec?: number;
  }
): SpeechSegment[] {
  const safeStart = Math.max(0, rangeStart);
  const safeEnd = Math.max(safeStart + 0.2, Math.min(durationSec || rangeEnd, rangeEnd));

  if (!energy20Hz.length || sampleRateHz <= 0) {
    return [{ start: safeStart, end: safeEnd }];
  }

  const thresholdDb = opts?.thresholdDb ?? -34;
  const minSilenceSec = Math.max(0.15, opts?.minSilenceSec ?? 0.45);
  const paddingSec = Math.max(0.03, Math.min(0.3, opts?.paddingSec ?? 0.09));

  // energy20Hz items are normalized linear amplitudes (0..1) or 0..255 ints.
  const isByteScale = energy20Hz.some((v) => v > 1.05);
  const thresholdLin = Math.pow(10, thresholdDb / 20);

  const startIdx = Math.max(0, Math.floor(safeStart * sampleRateHz));
  const endIdx = Math.min(energy20Hz.length - 1, Math.ceil(safeEnd * sampleRateHz));
  if (endIdx <= startIdx) {
    return [{ start: safeStart, end: safeEnd }];
  }

  // Adaptive safety: if entire clip is quieter than threshold, normalize relative to peak
  let localPeak = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const amp = isByteScale ? energy20Hz[i] / 255 : energy20Hz[i];
    if (amp > localPeak) localPeak = amp;
  }
  if (localPeak <= 0.0005) {
    return [{ start: safeStart, end: safeEnd }];
  }

  const effectiveThresh = Math.min(thresholdLin, localPeak * 0.42);
  const minSilenceFrames = Math.max(2, Math.round(minSilenceSec * sampleRateHz));

  const speechFrames: boolean[] = new Array(endIdx - startIdx + 1).fill(false);
  for (let i = startIdx; i <= endIdx; i++) {
    const amp = isByteScale ? energy20Hz[i] / 255 : energy20Hz[i];
    speechFrames[i - startIdx] = amp >= effectiveThresh;
  }

  // Bridge short silent gaps shorter than minSilenceFrames
  let i = 0;
  while (i < speechFrames.length) {
    if (speechFrames[i]) {
      i++;
      continue;
    }
    const gapStart = i;
    while (i < speechFrames.length && !speechFrames[i]) i++;
    const gapLen = i - gapStart;
    if (gapLen < minSilenceFrames && gapStart > 0 && i < speechFrames.length) {
      for (let k = gapStart; k < i; k++) speechFrames[k] = true;
    }
  }

  const rawSegs: SpeechSegment[] = [];
  let inSeg = false;
  let segStartIdx = 0;
  for (let f = 0; f < speechFrames.length; f++) {
    if (speechFrames[f] && !inSeg) {
      inSeg = true;
      segStartIdx = f;
    } else if (!speechFrames[f] && inSeg) {
      inSeg = false;
      const s = Math.max(safeStart, (startIdx + segStartIdx) / sampleRateHz - paddingSec);
      const e = Math.min(safeEnd, (startIdx + f) / sampleRateHz + paddingSec);
      if (e - s >= 0.14) rawSegs.push({ start: s, end: e });
    }
  }
  if (inSeg) {
    const s = Math.max(safeStart, (startIdx + segStartIdx) / sampleRateHz - paddingSec);
    const e = safeEnd;
    if (e - s >= 0.14) rawSegs.push({ start: s, end: e });
  }

  if (rawSegs.length === 0) {
    return [{ start: safeStart, end: safeEnd }];
  }

  // Merge touching segments and round cleanly
  const merged: SpeechSegment[] = [
    { start: Number(rawSegs[0].start.toFixed(2)), end: Number(rawSegs[0].end.toFixed(2)) },
  ];
  for (let k = 1; k < rawSegs.length; k++) {
    const prev = merged[merged.length - 1];
    const cur = rawSegs[k];
    if (cur.start <= prev.end + 0.06) {
      prev.end = Number(Math.max(prev.end, cur.end).toFixed(2));
    } else {
      merged.push({
        start: Number(cur.start.toFixed(2)),
        end: Number(cur.end.toFixed(2)),
      });
    }
  }

  return capSpeechSegments(merged, 42);
}

export function createDemoAudioProfile(durationSec = 12): AudioProfile {
  const sampleRateHz = 20;
  const totalSamples = Math.max(40, Math.round(durationSec * sampleRateHz));
  const energy20Hz: number[] = [];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRateHz;
    // Intentional pauses around 2.3-2.9s, 5.2-6.1s, 8.6-9.4s so Demo showcases Jump-Cut!
    const isPause =
      (t > 2.35 && t < 3.05) || (t > 5.2 && t < 6.05) || (t > 8.55 && t < 9.35);
    if (isPause) {
      energy20Hz.push(3);
    } else {
      const wave = 0.45 + 0.35 * Math.abs(Math.sin(t * 7.2)) + 0.15 * Math.cos(t * 17);
      energy20Hz.push(Math.min(255, Math.round(wave * 215)));
    }
  }

  const numBins = 280;
  const peaks: number[] = [];
  for (let b = 0; b < numBins; b++) {
    const s = Math.floor((b / numBins) * energy20Hz.length);
    const e = Math.max(s + 1, Math.floor(((b + 1) / numBins) * energy20Hz.length));
    let pk = 0;
    for (let k = s; k < e; k++) pk = Math.max(pk, energy20Hz[k] / 255);
    peaks.push(Number(pk.toFixed(3)));
  }

  return {
    mediaBlobId: 'demo',
    durationSec,
    peaks,
    energy20Hz,
    sampleRateHz,
  };
}

export function isSettingSilenceCompactable(settings: EditorSettings): boolean {
  const total = Math.max(0.1, settings.trimEnd - settings.trimStart);
  const kept = getEffectiveSourceDuration(settings);
  return Boolean(settings.silenceCutEnabled) && total - kept >= 0.2;
}
