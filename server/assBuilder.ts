export interface AssSubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface AssBuilderSettings {
  width: number;
  height: number;
  trimStart: number;
  trimEnd: number;
  speed: number;
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

  // Replace *keyword* segments with ASS primary color override
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

export function buildAssSubtitles(
  cues: AssSubtitleCue[],
  settings: AssBuilderSettings
): string {
  const speed = Math.max(0.25, Math.min(4, settings.speed || 1));
  const trimStart = Math.max(0, settings.trimStart);
  const trimEnd = Math.max(trimStart + 0.1, settings.trimEnd);

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
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events: string[] = [];
  for (const cue of cues) {
    if (cue.end <= trimStart || cue.start >= trimEnd) continue;
    const relStart = Math.max(0, (Math.max(cue.start, trimStart) - trimStart) / speed);
    const relEnd = Math.max(relStart + 0.08, (Math.min(cue.end, trimEnd) - trimStart) / speed);
    const body = formatCueInlineText(cue.text, settings);
    if (!body.trim()) continue;
    events.push(
      `Dialogue: 0,${formatAssTime(relStart)},${formatAssTime(relEnd)},Default,,0,0,0,,{\\an5\\pos(${centerX},${posY})}${body}`
    );
  }

  return [...header, ...events, ''].join('\n');
}
