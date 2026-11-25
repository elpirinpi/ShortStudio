import React, { useMemo, useRef } from 'react';
import { SubtitleCue } from '../types/editor';
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
  onSeek,
  onSelectSub,
  onMoveSub,
  onTrimStartChange,
  onTrimEndChange,
}: TimelineProps) {
  const tracksRef = useRef<HTMLDivElement | null>(null);
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
  const exportDur = Math.max(0, trimEnd - trimStart) / speed;

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

  const timeFromClientX = (clientX: number) => {
    const el = tracksRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * safeDur;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (trimDragRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbingRef.current = true;
    onSeek(timeFromClientX(e.clientX));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    onSeek(timeFromClientX(e.clientX));
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
    const t = timeFromClientX(e.clientX);
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
    <footer className="h-[168px] shrink-0 bg-[#12151c] border-t border-slate-800/90 flex flex-col">
      <div className="h-8 px-4 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
        <span>
          Línea de tiempo (arrastra los bordes del video para recortar o mueve bloques de subtítulos)
        </span>
        <div className="flex items-center gap-2 font-mono-tabular whitespace-nowrap">
          <span>
            {formatTime(trimStart)} – {formatTime(trimEnd)}
          </span>
          <span aria-hidden="true">·</span>
          <span>Duración final: {exportDur.toFixed(1)}s</span>
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

          {/* Video Trim Track */}
          <div className="h-7 bg-[#0b0d11] border border-slate-800 rounded-md relative overflow-hidden">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-400 z-10 pointer-events-none">
              Video
            </span>
            <div
              className="absolute top-0 bottom-0 bg-indigo-500/20 border-t border-b border-indigo-400/60"
              style={{ left: `${trimLeftPct}%`, width: `${trimWidthPct}%` }}
            >
              <button
                type="button"
                aria-label="Ajustar inicio de recorte"
                onPointerDown={(e) => handleTrimPointerDown(e, 'start')}
                onPointerMove={handleTrimPointerMove}
                onPointerUp={handleTrimPointerUp}
                className="absolute left-0 top-0 bottom-0 w-2.5 bg-indigo-500 hover:bg-indigo-400 cursor-ew-resize flex items-center justify-center"
              >
                <span className="w-0.5 h-3 bg-white/80 rounded-full" />
              </button>
              <button
                type="button"
                aria-label="Ajustar fin de recorte"
                onPointerDown={(e) => handleTrimPointerDown(e, 'end')}
                onPointerMove={handleTrimPointerMove}
                onPointerUp={handleTrimPointerUp}
                className="absolute right-0 top-0 bottom-0 w-2.5 bg-indigo-500 hover:bg-indigo-400 cursor-ew-resize flex items-center justify-center"
              >
                <span className="w-0.5 h-3 bg-white/80 rounded-full" />
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
          <div className="h-7 bg-[#0b0d11] border border-slate-800 rounded-md relative overflow-hidden">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-400 z-10 pointer-events-none">
              Música
            </span>
            {hasBgm && (
              <div className="absolute inset-1 bg-emerald-500/20 border border-emerald-500/50 rounded flex items-center pl-16 pr-2 text-[10px] text-emerald-200 truncate">
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
