import { EditorSettings, getCanvasDimensions, SubtitleCue } from '../types/editor';
import {
  getEffectiveOutputDuration,
  getEffectiveSpeechSegments,
  sourceTimeToOutputTime,
} from './clipTiming';
import { interpolateFaceAtTime } from './faceTracker';
import { hexToRgba, isColorBright } from './srt';

export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

interface RenderFrameParams {
  ctx: CanvasRenderingContext2D;
  blurCanvas: HTMLCanvasElement;
  blurCtx: CanvasRenderingContext2D;
  video: HTMLVideoElement | null;
  hasMedia: boolean;
  isDemo: boolean;
  currentTime: number;
  settings: EditorSettings;
  subtitles: SubtitleCue[];
}

interface ParsedWord {
  word: string;
  idx: number;
  width: number;
  emphasized: boolean;
}

function drawRoundedRectPath(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + radius, y);
  c.lineTo(x + w - radius, y);
  c.quadraticCurveTo(x + w, y, x + w, y + radius);
  c.lineTo(x + w, y + h - radius);
  c.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  c.lineTo(x + radius, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - radius);
  c.lineTo(x, y + radius);
  c.quadraticCurveTo(x, y, x + radius, y);
  c.closePath();
}

function drawDemoSource(
  targetCtx: CanvasRenderingContext2D,
  tw: number,
  th: number,
  t: number
) {
  const grad = targetCtx.createLinearGradient(0, 0, tw, th);
  const hue1 = (225 + t * 14) % 360;
  const hue2 = (340 + t * 12) % 360;
  grad.addColorStop(0, `hsl(${hue1}, 55%, 18%)`);
  grad.addColorStop(0.55, `hsl(${(hue1 + 25) % 360}, 45%, 12%)`);
  grad.addColorStop(1, `hsl(${hue2}, 58%, 17%)`);
  targetCtx.fillStyle = grad;
  targetCtx.fillRect(0, 0, tw, th);

  targetCtx.save();
  targetCtx.strokeStyle = 'rgba(255,255,255,0.04)';
  targetCtx.lineWidth = 2;
  for (let gx = 0; gx < tw; gx += 120) {
    targetCtx.beginPath();
    targetCtx.moveTo(gx, 0);
    targetCtx.lineTo(gx, th);
    targetCtx.stroke();
  }
  for (let gy = 0; gy < th; gy += 120) {
    targetCtx.beginPath();
    targetCtx.moveTo(0, gy);
    targetCtx.lineTo(tw, gy);
    targetCtx.stroke();
  }

  targetCtx.translate(tw / 2, th / 2);
  for (let i = 0; i < 4; i++) {
    targetCtx.beginPath();
    const rad = 115 + i * 82 + Math.sin(t * 2.8 + i) * 16;
    targetCtx.arc(
      Math.cos(t * 1.3 + i) * 55,
      Math.sin(t * 1.7 + i) * 35,
      rad,
      0,
      Math.PI * 2
    );
    targetCtx.strokeStyle = `rgba(255,255,255,${0.2 - i * 0.035})`;
    targetCtx.lineWidth = 4;
    targetCtx.stroke();
  }
  targetCtx.restore();

  // Moving speaker subject matching createDemoFaceKeyframes so face tracking visually locks onto it
  const subjX = tw * (0.5 + Math.sin(t * 0.85) * 0.16);
  const subjY = th * (0.44 + Math.cos(t * 0.7) * 0.04);

  targetCtx.save();
  targetCtx.translate(subjX, subjY);
  targetCtx.fillStyle = 'rgba(99, 102, 241, 0.25)';
  targetCtx.beginPath();
  targetCtx.arc(0, 0, 128, 0, Math.PI * 2);
  targetCtx.fill();

  targetCtx.strokeStyle = 'rgba(165, 180, 252, 0.75)';
  targetCtx.lineWidth = 4;
  targetCtx.beginPath();
  targetCtx.arc(0, 0, 118, 0, Math.PI * 2);
  targetCtx.stroke();

  // Minimal head & shoulders silhouette
  targetCtx.fillStyle = 'rgba(248, 250, 252, 0.88)';
  targetCtx.beginPath();
  targetCtx.arc(0, -24, 34, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.beginPath();
  targetCtx.ellipse(0, 48, 58, 36, 0, Math.PI, Math.PI * 2);
  targetCtx.fill();

  targetCtx.font = '700 30px "Plus Jakarta Sans", sans-serif';
  targetCtx.textAlign = 'center';
  targetCtx.textBaseline = 'middle';
  targetCtx.fillStyle = 'rgba(255,255,255,0.92)';
  targetCtx.fillText('SUJETO DEMO 16:9', 0, 162);
  targetCtx.restore();
}

function tokenizeWords(rawText: string): Array<{ word: string; emphasized: boolean }> {
  const tokens: Array<{ word: string; emphasized: boolean }> = [];
  const regex = /(\*[^*]+\*|\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(rawText)) !== null) {
    const chunk = match[1];
    if (chunk.startsWith('*') && chunk.endsWith('*') && chunk.length > 2) {
      const inner = chunk.slice(1, -1).trim();
      inner.split(/\s+/).forEach((w) => {
        if (w) tokens.push({ word: w, emphasized: true });
      });
    } else {
      tokens.push({ word: chunk, emphasized: false });
    }
  }
  return tokens;
}

function buildBalancedLines(
  items: ParsedWord[],
  maxLineWidth: number,
  spaceWidth: number
): Array<{ items: ParsedWord[]; width: number }> {
  const totalSingleWidth =
    items.reduce((acc, item) => acc + item.width, 0) +
    Math.max(0, items.length - 1) * spaceWidth;

  if (totalSingleWidth <= maxLineWidth || items.length <= 1) {
    return [{ items, width: totalSingleWidth }];
  }

  if (totalSingleWidth <= maxLineWidth * 1.92) {
    let bestSplit = -1;
    let bestDiff = Infinity;
    for (let split = 1; split < items.length; split++) {
      const left = items.slice(0, split);
      const right = items.slice(split);
      const wLeft =
        left.reduce((a, b) => a + b.width, 0) + Math.max(0, left.length - 1) * spaceWidth;
      const wRight =
        right.reduce((a, b) => a + b.width, 0) + Math.max(0, right.length - 1) * spaceWidth;
      if (wLeft <= maxLineWidth && wRight <= maxLineWidth) {
        const diff = Math.abs(wLeft - wRight);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestSplit = split;
        }
      }
    }
    if (bestSplit !== -1) {
      const left = items.slice(0, bestSplit);
      const right = items.slice(bestSplit);
      const wLeft =
        left.reduce((a, b) => a + b.width, 0) + Math.max(0, left.length - 1) * spaceWidth;
      const wRight =
        right.reduce((a, b) => a + b.width, 0) + Math.max(0, right.length - 1) * spaceWidth;
      return [
        { items: left, width: wLeft },
        { items: right, width: wRight },
      ];
    }
  }

  const lines: Array<{ items: ParsedWord[]; width: number }> = [];
  let currentLine: ParsedWord[] = [];
  let currentWidth = 0;

  items.forEach((item) => {
    const addW = currentLine.length === 0 ? item.width : spaceWidth + item.width;
    if (currentLine.length > 0 && currentWidth + addW > maxLineWidth) {
      lines.push({ items: currentLine, width: currentWidth });
      currentLine = [item];
      currentWidth = item.width;
    } else {
      currentLine.push(item);
      currentWidth += addW;
    }
  });
  if (currentLine.length > 0) {
    lines.push({ items: currentLine, width: currentWidth });
  }
  return lines;
}

function drawSubtitles(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  t: number,
  settings: EditorSettings,
  subtitles: SubtitleCue[]
) {
  const activeSub = subtitles.find((s) => t >= s.start && t <= s.end);
  if (!activeSub || !activeSub.text.trim()) return;

  const rawText = settings.subUpper ? activeSub.text.toUpperCase() : activeSub.text;
  const tokens = tokenizeWords(rawText);
  if (tokens.length === 0) return;

  ctx.save();
  ctx.font = `900 ${settings.subSize}px ${settings.subFont}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  let activeWordIdx = -1;
  let wordProgress = 1;
  if (settings.subMode !== 'classic') {
    const dur = Math.max(0.05, activeSub.end - activeSub.start);
    const progress = Math.max(0, Math.min(0.9999, (t - activeSub.start) / dur));
    const weights = tokens.map((tk) => tk.word.length + 2);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let i = 0; i < tokens.length; i++) {
      const span = weights[i] / totalWeight;
      if (progress <= acc + span || i === tokens.length - 1) {
        activeWordIdx = i;
        wordProgress = Math.max(0, Math.min(1, (progress - acc) / Math.max(0.001, span)));
        break;
      }
      acc += span;
    }
  }

  const parsedWords: ParsedWord[] = tokens.map((tk, idx) => ({
    word: tk.word,
    emphasized: tk.emphasized,
    idx,
    width: ctx.measureText(tk.word).width,
  }));

  const visibleWords =
    settings.subMode === 'reveal' && activeWordIdx >= 0
      ? parsedWords.slice(0, activeWordIdx + 1)
      : parsedWords;

  const effectiveMaxWidth = Math.min(settings.subMaxWidth, cw - 80);
  const spaceWidth = ctx.measureText(' ').width * 1.18;
  const lines = buildBalancedLines(visibleWords, effectiveMaxWidth, spaceWidth);

  let popScale = 1;
  if (settings.subPop) {
    const elapsed = Math.max(0, t - activeSub.start);
    if (elapsed < 0.14) {
      const p = elapsed / 0.14;
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const eased = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
      popScale = 0.74 + 0.26 * eased;
    }
  }

  const lineHeight = settings.subSize * 1.26;
  const totalHeight = lines.length * lineHeight;
  const maxContentWidth = Math.max(...lines.map((l) => l.width), 80);
  const centerY = (settings.subY / 100) * ch;

  ctx.translate(cw / 2, centerY);
  ctx.scale(popScale, popScale);

  if (settings.subBgMode === 'line-box' || settings.subBgMode === 'glass-card') {
    const padX = 34;
    const padY = 20;
    const boxW = maxContentWidth + padX * 2;
    const boxH = totalHeight + padY * 2 - settings.subSize * 0.18;
    const isGlass = settings.subBgMode === 'glass-card';

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = isGlass
      ? hexToRgba(settings.subBgColor, 0.76)
      : settings.subBgColor;
    drawRoundedRectPath(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 24);
    ctx.fill();

    if (isGlass) {
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.stroke();
    }
    ctx.restore();
  }

  const wordSpring =
    wordProgress < 0.35
      ? Math.sin((wordProgress / 0.35) * (Math.PI / 2))
      : 1 - Math.min(1, (wordProgress - 0.35) / 0.65) * 0.35;

  lines.forEach((line, lineIdx) => {
    const y = -totalHeight / 2 + lineIdx * lineHeight + lineHeight / 2;
    let x = -line.width / 2;

    line.items.forEach((item) => {
      const isActive = item.idx === activeWordIdx;
      const isHighlighted =
        settings.subMode === 'classic' ? item.emphasized : isActive || item.emphasized;

      const useWordPill =
        settings.subBgMode === 'word-pill' &&
        (settings.subMode === 'classic' ? item.emphasized : isActive);

      ctx.save();
      const wordCenterX = x + item.width / 2;
      let wordY = y;

      if (isActive) {
        if (settings.subMode === 'bounce') {
          const jump = -10 * wordSpring;
          const sc = 1 + 0.16 * wordSpring;
          wordY += jump;
          ctx.translate(wordCenterX, wordY);
          ctx.scale(sc, sc);
          ctx.translate(-wordCenterX, -wordY);
        } else if (!useWordPill) {
          const sc = 1 + 0.1 * wordSpring;
          ctx.translate(wordCenterX, y);
          ctx.scale(sc, sc);
          ctx.translate(-wordCenterX, -y);
        }
      }

      if (useWordPill) {
        const padX = 16;
        const padY = settings.subSize * 0.54;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 5;
        ctx.fillStyle = settings.subHighlight;
        drawRoundedRectPath(
          ctx,
          x - padX,
          wordY - padY,
          item.width + padX * 2,
          padY * 2,
          18
        );
        ctx.fill();
        ctx.restore();
      }

      if (settings.subShadow > 0 && !useWordPill) {
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = settings.subShadow;
        ctx.shadowOffsetY = Math.round(settings.subShadow * 0.35);
      }

      if (settings.subStroke > 0 && !useWordPill) {
        ctx.lineWidth = settings.subStroke;
        ctx.strokeStyle = settings.subStrokeColor;
        ctx.strokeText(item.word, x, wordY);
      }

      ctx.shadowColor = 'transparent';
      if (useWordPill) {
        ctx.fillStyle = isColorBright(settings.subHighlight) ? '#090d16' : '#ffffff';
      } else if (isHighlighted) {
        ctx.fillStyle = settings.subHighlight;
      } else if (settings.subBgMode === 'line-box' && isColorBright(settings.subBgColor)) {
        ctx.fillStyle = '#090d16';
      } else {
        ctx.fillStyle = settings.subColor;
      }

      ctx.fillText(item.word, x, wordY);
      ctx.restore();

      x += item.width + spaceWidth;
    });
  });

  ctx.restore();
}

export interface TrackedPlacement {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  faceBoxOnCanvas: {
    xPct: number;
    yPct: number;
    wPct: number;
    hPct: number;
    confidence: number;
  } | null;
}

export function computeTrackedPlacement(
  cw: number,
  ch: number,
  sw: number,
  sh: number,
  settings: EditorSettings,
  currentTime: number
): TrackedPlacement {
  const zoom = settings.zoom / 100;
  const panX = settings.panX / 100;
  const panY = settings.panY / 100;

  const activeFace =
    settings.faceTracking && settings.faceKeyframes && settings.faceKeyframes.length > 0
      ? interpolateFaceAtTime(settings.faceKeyframes, currentTime)
      : null;

  let dx = 0;
  let dy = 0;
  let dw = cw;
  let dh = ch;

  if (settings.fitMode === 'cover') {
    const s = Math.max(cw / sw, ch / sh) * zoom;
    dw = sw * s;
    dh = sh * s;
    const maxShiftX = Math.max(0, (dw - cw) / 2);
    const maxShiftY = Math.max(0, (dh - ch) / 2);

    if (activeFace) {
      const targetHeadroom = (settings.faceHeadroom ?? 36) / 100;
      const trackShiftX = dw * (0.5 - activeFace.x);
      const trackShiftY = ch * (targetHeadroom - 0.5) + dh * (0.5 - activeFace.y);

      const rawShiftX = trackShiftX + panX * (maxShiftX * 0.5 || cw * 0.1);
      const rawShiftY = trackShiftY + panY * (maxShiftY * 0.5 || ch * 0.1);

      const clampedShiftX =
        maxShiftX > 0 ? Math.max(-maxShiftX, Math.min(maxShiftX, rawShiftX)) : 0;
      const clampedShiftY =
        maxShiftY > 0 ? Math.max(-maxShiftY, Math.min(maxShiftY, rawShiftY)) : 0;

      dx = (cw - dw) / 2 + clampedShiftX;
      dy = (ch - dh) / 2 + clampedShiftY;
    } else {
      dx = (cw - dw) / 2 + panX * (maxShiftX || cw * 0.15);
      dy = (ch - dh) / 2 + panY * (maxShiftY || ch * 0.15);
    }
  } else {
    const s = Math.min(cw / sw, ch / sh) * zoom;
    dw = sw * s;
    dh = sh * s;

    if (activeFace && zoom > 1.01) {
      const targetHeadroom = (settings.faceHeadroom ?? 36) / 100;
      const trackShiftX = Math.max(-cw * 0.25, Math.min(cw * 0.25, dw * (0.5 - activeFace.x)));
      const trackShiftY = Math.max(
        -ch * 0.25,
        Math.min(ch * 0.25, ch * (targetHeadroom - 0.5) + dh * (0.5 - activeFace.y))
      );
      dx = (cw - dw) / 2 + trackShiftX + panX * cw * 0.15;
      dy = (ch - dh) / 2 + trackShiftY + panY * ch * 0.15;
    } else {
      dx = (cw - dw) / 2 + panX * cw * 0.25;
      dy = (ch - dh) / 2 + panY * ch * 0.25;
    }
  }

  let faceBoxOnCanvas: TrackedPlacement['faceBoxOnCanvas'] = null;
  if (activeFace) {
    const boxW = activeFace.w * dw;
    const boxH = activeFace.h * dh;
    const boxCenterX = dx + activeFace.x * dw;
    const boxCenterY = dy + activeFace.y * dh;
    faceBoxOnCanvas = {
      xPct: ((boxCenterX - boxW / 2) / cw) * 100,
      yPct: ((boxCenterY - boxH / 2) / ch) * 100,
      wPct: (boxW / cw) * 100,
      hPct: (boxH / ch) * 100,
      confidence: activeFace.confidence,
    };
  }

  return { dx, dy, dw, dh, faceBoxOnCanvas };
}

export function renderEditorFrame({
  ctx,
  blurCanvas,
  blurCtx,
  video,
  hasMedia,
  isDemo,
  currentTime,
  settings,
  subtitles,
}: RenderFrameParams): void {
  const { width: cw, height: ch } = getCanvasDimensions(settings.ratio);

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, cw, ch);

  if (!hasMedia && !isDemo) return;

  const sw = isDemo ? 1920 : video?.videoWidth || 1080;
  const sh = isDemo ? 1080 : video?.videoHeight || 1920;

  const hasColorFilter =
    settings.bright !== 100 || settings.contrast !== 100 || settings.sat !== 100;

  const paintMedia = (
    targetCtx: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) => {
    if (isDemo) {
      targetCtx.save();
      targetCtx.translate(dx, dy);
      targetCtx.scale(dw / sw, dh / sh);
      drawDemoSource(targetCtx, sw, sh, currentTime);
      targetCtx.restore();
    } else if (video && video.readyState >= 2) {
      targetCtx.drawImage(video, dx, dy, dw, dh);
    }
  };

  if (settings.fitMode === 'blur') {
    const bwTarget = Math.max(64, Math.round(cw / 8));
    const bhTarget = Math.max(64, Math.round(ch / 8));
    if (blurCanvas.width !== bwTarget || blurCanvas.height !== bhTarget) {
      blurCanvas.width = bwTarget;
      blurCanvas.height = bhTarget;
    }

    const bScale = Math.max(blurCanvas.width / sw, blurCanvas.height / sh);
    const bw = sw * bScale;
    const bh = sh * bScale;
    const bx = (blurCanvas.width - bw) / 2;
    const by = (blurCanvas.height - bh) / 2;

    blurCtx.save();
    blurCtx.filter = 'blur(8px) brightness(0.6) saturate(1.15)';
    paintMedia(blurCtx, bx, by, bw, bh);
    blurCtx.restore();

    ctx.drawImage(blurCanvas, 0, 0, cw, ch);
  }

  const { dx, dy, dw, dh } = computeTrackedPlacement(cw, ch, sw, sh, settings, currentTime);

  ctx.save();
  if (hasColorFilter) {
    ctx.filter = `brightness(${settings.bright}%) contrast(${settings.contrast}%) saturate(${settings.sat}%)`;
  }

  if (settings.fitMode !== 'cover' && settings.fitMode === 'blur' && settings.rounded) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 45;
    ctx.shadowOffsetY = 16;
    drawRoundedRectPath(ctx, dx, dy, dw, dh, 38);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    ctx.save();
    drawRoundedRectPath(ctx, dx, dy, dw, dh, 38);
    ctx.clip();
    paintMedia(ctx, dx, dy, dw, dh);
    ctx.restore();
  } else {
    paintMedia(ctx, dx, dy, dw, dh);
  }
  ctx.restore();

  if (settings.progressBar) {
    const segDur = Math.max(0.1, settings.trimEnd - settings.trimStart);
    const progress = Math.max(0, Math.min(1, (currentTime - settings.trimStart) / segDur));
    const barH = 14;
    const barY = settings.progressPos === 'top' ? 0 : ch - barH;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(0, barY, cw, barH);
    ctx.fillStyle = settings.progressColor;
    ctx.fillRect(0, barY, cw * progress, barH);
  }

  if (settings.watermarkEnabled && settings.watermarkText?.trim()) {
    const text = settings.watermarkText.trim();
    const opacity = Math.max(0.15, Math.min(1, (settings.watermarkOpacity ?? 75) / 100));
    const pos = settings.watermarkPos || 'top-right';
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = '700 28px "Plus Jakarta Sans", sans-serif';
    const textW = ctx.measureText(text).width;
    const padX = 22;
    const boxW = textW + padX * 2;
    const boxH = 50;
    const marginX = 44;
    const marginY = settings.progressBar && settings.progressPos === 'top' ? 68 : 54;
    const bottomMarginY = settings.progressBar && settings.progressPos === 'bottom' ? 68 : 54;

    const bx = pos.endsWith('left') ? marginX : cw - marginX - boxW;
    const by = pos.startsWith('top') ? marginY : ch - bottomMarginY - boxH;

    ctx.fillStyle = 'rgba(11, 13, 17, 0.58)';
    drawRoundedRectPath(ctx, bx, by, boxW, boxH, 14);
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + boxW / 2, by + boxH / 2 + 1);
    ctx.restore();
  }

  drawSubtitles(ctx, cw, ch, currentTime, settings, subtitles);
}
