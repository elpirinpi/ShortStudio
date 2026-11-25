export interface AssSubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface AssSpeechSegment {
  start: number;
  end: number;
}

export interface AssHookConfig {
  enabled?: boolean;
  text?: string;
  style?: 'white-box' | 'dark-neon' | 'red-hook' | 'minimal-clean';
  bgColor?: string;
  textColor?: string;
  yPct?: number;
  durationSec?: number;
}

export interface AssBuilderSettings {
  width: number;
  height: number;
  trimStart: number;
  trimEnd: number;
  speed: number;
  speechSegments?: AssSpeechSegment[];
  subUpper: boolean;
  subSize: number;
  subY: number;
  subStroke: number;
  subShadow: number;
  subColor: string;
  subHighlight: string;
  subStrokeColor: string;
  subBgColor: string;
  subBgMode: 'none' | 'word-pill' | 'line-box' | 'glass-card';
  hook?: AssHookConfig;
}

function hexToAssColor(hex: string, alphaHex = '00'): string {
  const clean = (hex || '#ffffff').replace('#', '').trim();
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean.padEnd(6, 'f').slice(0, 6);
  const rr = full.slice(0, 2);
  const gg = full.slice(2, 4);
  const bb = full.slice(4, 6);
  return `&H${alphaHex}${bb}${gg}${rr}`.toUpperCase();
}

function formatAssTime(sec: number): string {
  const safe = Math.max(0, sec);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.min(99, Math.floor((safe - Math.floor(safe)) * 100));
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

function formatCueInlineText(cueText: string, s: AssBuilderSettings): string {
  const baseColor = hexToAssColor(s.subColor, '00');
  const highlightColor = hexToAssColor(s.subHighlight, '00');
  const normalized = s.subUpper ? cueText.toUpperCase() : cueText;

  const tokens = normalized.split(/(\*[^*]+\*)/g);
  return tokens
    .map((part) => {
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        const inner = escapeAssText(part.slice(1, -1));
        return `{\\c${highlightColor}}${inner}{\\c${baseColor}}`;
      }
      return escapeAssText(part);
    })
    .join('');
}

function mapCueToOutputRange(
  cueStart: number,
  cueEnd: number,
  segments: AssSpeechSegment[],
  speed: number
): { start: number; end: number } | null {
  let outStart: number | null = null;
  let outEnd: number | null = null;
  let accSrc = 0;

  for (const seg of segments) {
    const ovStart = Math.max(cueStart, seg.start);
    const ovEnd = Math.min(cueEnd, seg.end);
    if (ovEnd > ovStart + 0.02) {
      const sOut = (accSrc + (ovStart - seg.start)) / speed;
      const eOut = (accSrc + (ovEnd - seg.start)) / speed;
      if (outStart === null) outStart = sOut;
      outEnd = eOut;
    }
    accSrc += Math.max(0, seg.end - seg.start);
  }

  if (outStart === null || outEnd === null || outEnd <= outStart + 0.04) {
    return null;
  }
  return { start: outStart, end: outEnd };
}

export function buildAssSubtitles(
  cues: AssSubtitleCue[],
  settings: AssBuilderSettings
): string {
  const speed = Math.max(0.25, Math.min(4, settings.speed || 1));
  const trimStart = Math.max(0, settings.trimStart);
  const trimEnd = Math.max(trimStart + 0.1, settings.trimEnd);

  const segments: AssSpeechSegment[] =
    Array.isArray(settings.speechSegments) && settings.speechSegments.length > 0
      ? settings.speechSegments
          .map((seg) => ({
            start: Math.max(trimStart, seg.start),
            end: Math.min(trimEnd, seg.end),
          }))
          .filter((seg) => seg.end - seg.start >= 0.08)
      : [{ start: trimStart, end: trimEnd }];
  const effectiveSegments = segments.length > 0 ? segments : [{ start: trimStart, end: trimEnd }];
  const totalOutDuration =
    effectiveSegments.reduce((acc, seg) => acc + Math.max(0, seg.end - seg.start), 0) / speed;

  const primary = hexToAssColor(settings.subColor, '00');
  const outline = hexToAssColor(settings.subStrokeColor, '00');
  const backAlpha = settings.subBgMode === 'line-box' || settings.subBgMode === 'glass-card' ? '33' : '80';
  const back = hexToAssColor(settings.subBgColor, backAlpha);
  const borderStyle = settings.subBgMode === 'line-box' || settings.subBgMode === 'glass-card' ? 3 : 1;
  const outlinePx = Math.max(0, Math.min(12, Math.round((settings.subStroke || 0) * 0.35)));
  const shadowPx = Math.max(0, Math.min(6, Math.round((settings.subShadow || 0) * 0.18)));
  const fontSize = Math.max(24, Math.min(120, Math.round(settings.subSize || 64)));

  const centerX = Math.round(settings.width / 2);
  const posY = Math.round((Math.max(10, Math.min(92, settings.subY || 68)) / 100) * settings.height);

  // Top Hook Banner Style
  const hook = settings.hook;
  const hookActive = Boolean(hook?.enabled && hook?.text?.trim());
  const hookStyleMode = hook?.style || 'white-box';
  const hookBgHex =
    hookStyleMode === 'dark-neon'
      ? hook?.bgColor || '#0f172a'
      : hookStyleMode === 'red-hook'
      ? hook?.bgColor || '#e11d48'
      : hookStyleMode === 'white-box'
      ? hook?.bgColor || '#ffffff'
      : '#000000';
  const hookTxtHex =
    hookStyleMode === 'white-box'
      ? hook?.textColor || '#0f172a'
      : hook?.textColor || '#ffffff';
  const hookPrimary = hexToAssColor(hookTxtHex, '00');
  const hookBack = hexToAssColor(hookBgHex, hookStyleMode === 'minimal-clean' ? 'FF' : '08');
  const hookOutlineCol =
    hookStyleMode === 'dark-neon'
      ? hexToAssColor('#22d3ee', '00')
      : hookStyleMode === 'minimal-clean'
      ? hexToAssColor('#000000', '00')
      : hexToAssColor(hookBgHex, '08');
  const hookBorderStyle = hookStyleMode === 'minimal-clean' ? 1 : 3;
  const hookOutlinePx = hookStyleMode === 'minimal-clean' ? 5 : 16;
  const hookFontSize = Math.round(settings.width * 0.044);

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${settings.width}`,
    `PlayResY: ${settings.height}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 2',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Size, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial,${fontSize},${primary},${primary},${outline},${back},-1,0,0,0,100,100,0,0,${borderStyle},${outlinePx},${shadowPx},2,60,60,40,1`,
    `Style: Hook,Arial,${hookFontSize},${hookPrimary},${hookPrimary},${hookOutlineCol},${hookBack},-1,0,0,0,100,100,0,0,${hookBorderStyle},${hookOutlinePx},4,5,54,54,30,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events: string[] = [];

  if (hookActive && hook?.text) {
    const hookY = Math.round((Math.max(8, Math.min(45, hook.yPct ?? 14)) / 100) * settings.height);
    const durCap =
      hook.durationSec && hook.durationSec > 0
        ? Math.min(totalOutDuration, hook.durationSec)
        : totalOutDuration;
    const hookText = escapeAssText(hook.text.trim());
    events.push(
      `Dialogue: 2,0:00:00.00,${formatAssTime(Math.max(0.4, durCap))},Hook,,0,0,0,,{\\an5\\pos(${centerX},${hookY})\\fad(160,180)}${hookText}`
    );
  }

  for (const cue of cues) {
    if (cue.end <= trimStart || cue.start >= trimEnd) continue;
    const mapped = mapCueToOutputRange(cue.start, cue.end, effectiveSegments, speed);
    if (!mapped) continue;
    const body = formatCueInlineText(cue.text, settings);
    if (!body.trim()) continue;
    events.push(
      `Dialogue: 0,${formatAssTime(mapped.start)},${formatAssTime(mapped.end)},Default,,0,0,0,,{\\an5\\pos(${centerX},${posY})}${body}`
    );
  }

  return [...header, ...events, ''].join('\n');
}
