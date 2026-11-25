import React, { useEffect, useMemo, useRef } from 'react';
import { SpeechSegment, SubtitleCue } from '../types/editor';
import { getEffectiveOutputDuration } from '../utils/clipTiming';
import { formatTime } from '../utils/srt';

interface TimelineProps {
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  speed: number;
  hasBgm: boolean;
  bgmName: string;
  subtitles: SubtitleCue[];
  selectedSubId: number | null;
  audioPeaks?: number[];
  waveformLoading?: boolean;
  silenceCutEnabled?: boolean;
  speechSegments?: SpeechSegment[];
  onSeek: (time: number) => void;
  onSelectSub: (id: number) => void;
  onMoveSub: (id: number, start: number, end: number) => void;
  onTrimStartChange: (val: number) => void;
  onTrimEndChange: (val: number) => void;
}

export function Timeline({
  duration,
  currentTime,
  trimStart,
  trimEnd,
  speed,
  hasBgm,
  bgmName,
  subtitles,
  selectedSubId,
  audioPeaks,
  waveformLoading = false,
  silenceCutEnabled = false,
  speechSegments,
  onSeek,
  onSelectSub,
  onMoveSub,
  onTrimStartChange,
  onTrimEndChange,
}: TimelineProps) {
  const tracksRef = useRef<HTMLDivElement | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrubbingRef = useRef(false);
  const trimDragRef = useRef<'start' | 'end' | null>(null);
  const dragCueRef = useRef<{
    id: number;
    startX: number;
    origStart: number;
    origEnd: number;
    moved: boolean;
  } | null>(null);

  const safeDur = Math.max(0.1, duration);
  const playheadPct = Math.max(0, Math.min(100, (currentTime / safeDur) * 100));
  const trimLeftPct = (trimStart / safeDur) * 100;
  const trimWidthPct = Math.max(0.5, ((trimEnd - trimStart) / safeDur) * 100);
  const rawSpanDur = Math.max(0, trimEnd - trimStart) / speed;
  const exportDur = getEffectiveOutputDuration({
    trimStart,
    trimEnd,
    speed,
    silenceCutEnabled,
    speechSegments,
  });
  const savedSec = Math.max(0, rawSpanDur - exportDur);

  const rulerTicks = useMemo(() => {
    const count = 6;
    const ticks: Array<{ pct: number; label: string }> = [];
    for (let i = 0; i <= count; i++) {
      const pct = (i / count) * 100;
      const t = (i / count) * safeDur;
      ticks.push({ pct, label: formatTime(t) });
    }
    return ticks;
  }, [safeDur]);

  const snapTime = (rawTime: number, clientWidth: number): number => {
    const pxTolerance = 6;
    const secTol = (pxTolerance / Math.max(120, clientWidth)) * safeDur;
    const anchors: number[] = [trimStart, trimEnd];
    for (const s of subtitles) {
      anchors.push(s.start, s.end);
    }
    if (silenceCutEnabled && speechSegments) {
      for (const seg of speechSegments) {
        anchors.push(seg.start, seg.end);
      }
    }
    let best = rawTime;
    let bestDist = secTol;
    for (const a of anchors) {
      const d = Math.abs(rawTime - a);
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }
    return best;
  };

  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;

    const drawWaveform = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const peaks = audioPeaks;
      if (!peaks || peaks.length === 0) return;

      const midY = h / 2;
      const maxAmpH = Math.max(4, h * 0.42);
      const barCount = Math.max(40, Math.min(peaks.length, Math.floor(w / 3)));

      for (let i = 0; i < barCount; i++) {
        const ratio = (i + 0.5) / barCount;
        const t = ratio * safeDur;
        const peakIdx = Math.min(peaks.length - 1, Math.floor(ratio * peaks.length));
        const val = Math.max(0.06, Math.min(1, peaks[peakIdx] || 0));
        const inTrim = t >= trimStart && t <= trimEnd;

        let isKept = true;
        if (inTrim && silenceCutEnabled && speechSegments && speechSegments.length > 0) {
          isKept = speechSegments.some((seg) => t >= seg.start && t <= seg.end);
        }

        if (!inTrim) {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
        } else if (!isKept) {
          ctx.fillStyle = 'rgba(244, 63, 94, 0.36)';
        } else {
          ctx.fillStyle = 'rgba(129, 140, 248, 0.78)';
        }

        const x = (i / barCount) * w;
        const barW = Math.max(1.5, w / barCount - 1);
        const bh = Math.max(2, val * maxAmpH * 2);
        ctx.fillRect(x, midY - bh / 2, barW, bh);
      }
    };

    drawWaveform();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(drawWaveform) : null;
    if (ro) ro.observe(canvas);
    return () => ro?.disconnect();
  }, [audioPeaks, safeDur, trimStart, trimEnd, silenceCutEnabled, speechSegments]);

  const timeFromClientX = (clientX: number, enableSnap = false) => {
    const el = tracksRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = ratio * safeDur;
    return enableSnap ? snapTime(t, rect.width) : t;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (trimDragRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbingRef.current = true;
    onSeek(timeFromClientX(e.clientX, true));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    onSeek(timeFromClientX(e.clientX, false));
  };

  const handlePointerUp = () => {
    scrubbingRef.current = false;
  };

  const handleTrimPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    edge: 'start' | 'end'
  ) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    trimDragRef.current = edge;
  };

  const handleTrimPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const edge = trimDragRef.current;
    if (!edge) return;
    e.stopPropagation();
    const t = timeFromClientX(e.clientX, true);
    if (edge === 'start') {
      onTrimStartChange(Math.max(0, Math.min(trimEnd - 0.3, t)));
    } else {
      onTrimEndChange(Math.max(trimStart + 0.3, Math.min(safeDur, t)));
    }
  };

  const handleTrimPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    trimDragRef.current = null;
  };

  const handleCuePointerDown = (e: React.PointerEvent<HTMLButtonElement>, sub: SubtitleCue) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelectSub(sub.id);
    dragCueRef.current = {
      id: sub.id,
      startX: e.clientX,
      origStart: sub.start,
      origEnd: sub.end,
      moved: false,
    };
  };

  const handleCuePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragCueRef.current;
    const el = tracksRef.current;
    if (!drag || !el) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (!drag.moved) return;

    const width = Math.max(1, el.getBoundingClientRect().width);
    const deltaSec = (dx / width) * safeDur;
    const cueLen = drag.origEnd - drag.origStart;
    const nextStart = Math.max(0, Math.min(safeDur - cueLen, drag.origStart + deltaSec));
    onMoveSub(drag.id, Number(nextStart.toFixed(2)), Number((nextStart + cueLen).toFixed(2)));
  };

  const handleCuePointerUp = (_e: React.PointerEvent<HTMLButtonElement>, sub: SubtitleCue) => {
    const drag = dragCueRef.current;
    dragCueRef.current = null;
    if (drag && !drag.moved) {
      onSeek(sub.start + 0.05);
    }
  };

  return (
    <footer className="h-[176px] shrink-0 bg-[#12151c] border-t border-slate-800/90 flex flex-col">
      <div className="h-8 px-4 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
        <span className="truncate pr-3">
          Línea de tiempo{' '}
          {waveformLoading
            ? '· Analizando onda de audio...'
            : audioPeaks?.length
            ? '· Onda de audio y ajuste magnético activos'
            : '(arrastra bordes del clip o bloques de subtítulos)'}
        </span>
        <div className="flex items-center gap-2 font-mono-tabular whitespace-nowrap">
          <span>
            {formatTime(trimStart)} – {formatTime(trimEnd)}
          </span>
          <span aria-hidden="true">·</span>
          <span>Duración final: {exportDur.toFixed(1)}s</span>
          {savedSec >= 0.2 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400">-{savedSec.toFixed(1)}s silencios</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span className={exportDur > 60 ? 'text-amber-400 font-medium' : 'text-slate-400'}>
            {exportDur > 60 ? 'Supera 60s (límite Shorts)' : 'Apto para Shorts y TikTok'}
          </span>
        </div>
      </div>

      <div className="flex-1 px-4 py-2 overflow-hidden">
        <div
          ref={tracksRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="relative h-full w-full flex flex-col justify-between gap-1.5 cursor-pointer"
        >
          {/* Time Ruler */}
          <div className="h-4 relative text-[10px] font-mono-tabular text-slate-500 select-none pointer-events-none">
            {rulerTicks.map((tick, idx) => (
              <span
                key={idx}
                className="absolute top-0"
                style={{
                  left: `${tick.pct}%`,
                  transform:
                    idx === 0
                      ? 'translateX(0%)'
                      : idx === rulerTicks.length - 1
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)',
                }}
              >
                {tick.label}
              </span>
            ))}
          </div>

          {/* Video Trim + Audio Waveform Track */}
          <div className="h-9 bg-[#0b0d11] border border-slate-800 rounded-md relative overflow-hidden">
            <canvas
              ref={waveCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
            <span className="absolute left-2.5 top-1 text-[10px] font-semibold text-slate-300/90 z-10 pointer-events-none drop-shadow">
              Video y Onda
            </span>
            <div
              className="absolute top-0 bottom-0 bg-indigo-500/12 border-t border-b border-indigo-400/65"
              style={{ left: `${trimLeftPct}%`, width: `${trimWidthPct}%` }}
            >
              <button
                type="button"
                aria-label="Ajustar inicio de recorte"
                onPointerDown={(e) => handleTrimPointerDown(e, 'start')}
                onPointerMove={handleTrimPointerMove}
                onPointerUp={handleTrimPointerUp}
                className="absolute left-0 top-0 bottom-0 w-2.5 bg-indigo-500 hover:bg-indigo-400 cursor-ew-resize flex items-center justify-center z-20"
              >
                <span className="w-0.5 h-4 bg-white/80 rounded-full" />
              </button>
              <button
                type="button"
                aria-label="Ajustar fin de recorte"
                onPointerDown={(e) => handleTrimPointerDown(e, 'end')}
                onPointerMove={handleTrimPointerMove}
                onPointerUp={handleTrimPointerUp}
                className="absolute right-0 top-0 bottom-0 w-2.5 bg-indigo-500 hover:bg-indigo-400 cursor-ew-resize flex items-center justify-center z-20"
              >
                <span className="w-0.5 h-4 bg-white/80 rounded-full" />
              </button>
            </div>
          </div>

          {/* Subtitles Track */}
          <div className="h-7 bg-[#0b0d11] border border-slate-800 rounded-md relative overflow-hidden">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-400 z-10 pointer-events-none">
              Subtítulos
            </span>
            {subtitles.map((sub) => {
              const left = (sub.start / safeDur) * 100;
              const width = Math.max(1.4, ((sub.end - sub.start) / safeDur) * 100);
              const isSelected = sub.id === selectedSubId;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onPointerDown={(e) => handleCuePointerDown(e, sub)}
                  onPointerMove={handleCuePointerMove}
                  onPointerUp={(e) => handleCuePointerUp(e, sub)}
                  style={{ left: `${Math.max(0, left)}%`, width: `${width}%` }}
                  className={`absolute top-1 bottom-1 rounded text-[10px] font-medium px-1.5 flex items-center overflow-hidden whitespace-nowrap cursor-grab active:cursor-grabbing transition-colors ${
                    isSelected
                      ? 'bg-amber-400 text-slate-950 z-20 ring-1 ring-white'
                      : 'bg-sky-600/85 text-white hover:bg-sky-500 z-10'
                  }`}
                >
                  <span className="truncate">{sub.text.replace(/\*([^*]+)\*/g, '$1')}</span>
                </button>
              );
            })}
          </div>

          {/* BGM Track */}
          <div className="h-6 bg-[#0b0d11] border border-slate-800 rounded-md relative overflow-hidden">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-400 z-10 pointer-events-none">
              Música
            </span>
            {hasBgm && (
              <div className="absolute inset-0.5 bg-emerald-500/20 border border-emerald-500/50 rounded flex items-center pl-16 pr-2 text-[10px] text-emerald-200 truncate">
                {bgmName}
              </div>
            )}
          </div>

          {/* Playhead */}
          <div
            className="absolute top-4 bottom-0 w-0.5 bg-rose-500 z-30 pointer-events-none"
            style={{ left: `${playheadPct}%` }}
          >
            <div className="w-2.5 h-2.5 bg-rose-500 rotate-45 -translate-x-1 -translate-y-1" />
          </div>
        </div>
      </div>
    </footer>
  );
}
