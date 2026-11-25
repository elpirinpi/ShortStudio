import { SubtitleCue } from '../types/editor';

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const tenths = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

export function formatSrtTimestamp(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(
    2,
    '0'
  )},${String(Math.min(999, ms)).padStart(3, '0')}`;
}

export function exportSubtitlesToSRT(subtitles: SubtitleCue[]): string {
  const sorted = [...subtitles].sort((a, b) => a.start - b.start);
  return sorted
    .map((cue, index) => {
      const cleanText = cue.text.replace(/\*([^*]+)\*/g, '$1').trim();
      return `${index + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(
        cue.end
      )}\n${cleanText}`;
    })
    .join('\n\n');
}

export function isColorBright(hex: string): boolean {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return true;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 145;
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(15, 23, 42, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function parseSRT(srtText: string): SubtitleCue[] {
  const blocks = srtText.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  const parsed: SubtitleCue[] = [];

  const toSeconds = (tc: string): number => {
    const match = tc.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!match) return 0;
    return (
      parseInt(match[1], 10) * 3600 +
      parseInt(match[2], 10) * 60 +
      parseInt(match[3], 10) +
      parseInt(match[4], 10) / 1000
    );
  };

  blocks.forEach((block, idx) => {
    const lines = block.split('\n');
    const timeLineIdx = lines.findIndex((line) => line.includes('-->'));
    if (timeLineIdx === -1) return;

    const [startStr, endStr] = lines[timeLineIdx].split('-->');
    if (!startStr || !endStr) return;

    const text = lines
      .slice(timeLineIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();

    if (text) {
      const start = Number(toSeconds(startStr).toFixed(2));
      const end = Number(Math.max(start + 0.3, toSeconds(endStr)).toFixed(2));
      parsed.push({
        id: Date.now() + idx,
        start,
        end,
        text,
      });
    }
  });

  return parsed;
}

export function splitScriptToSubtitles(
  scriptText: string,
  wordsPerBlock: number,
  trimStart: number,
  trimEnd: number
): SubtitleCue[] {
  const words = scriptText.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerBlock) {
    chunks.push(words.slice(i, i + wordsPerBlock).join(' '));
  }

  // Weight duration proportionally by character count so longer chunks get more screen time
  const weights = chunks.map((c) => Math.max(4, c.replace(/\*/g, '').length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const totalRange = Math.max(1, trimEnd - trimStart);

  let cursor = trimStart;
  return chunks.map((chunk, idx) => {
    const dur = (weights[idx] / totalWeight) * totalRange;
    const start = Number(cursor.toFixed(2));
    const end = Number(Math.max(start + 0.25, cursor + dur - 0.03).toFixed(2));
    cursor += dur;
    return {
      id: Date.now() + idx,
      start,
      end,
      text: chunk,
    };
  });
}
