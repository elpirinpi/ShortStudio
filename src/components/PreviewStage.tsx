import React, { useRef, useState } from 'react';
import { Film, Pause, Play, Repeat, ScanFace, Upload } from 'lucide-react';
import { getCanvasDimensions, SafeZoneMode, TargetRatio } from '../types/editor';
import { TrackedPlacement } from '../utils/canvasRenderer';
import { formatTime } from '../utils/srt';

interface PreviewStageProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  ratio: TargetRatio;
  safeZone: SafeZoneMode;
  onSafeZoneChange: (mode: SafeZoneMode) => void;
  faceBox: TrackedPlacement['faceBoxOnCanvas'];
  faceTrackingEnabled: boolean;
  showFaceGuide: boolean;
  onToggleFaceGuide: () => void;
  hasMediaOrDemo: boolean;
  isPlaying: boolean;
  loop: boolean;
  currentTime: number;
  duration: number;
  panX: number;
  panY: number;
  onPanChange: (panX: number, panY: number) => void;
  onDropFile: (file: File) => void;
  onChooseVideo: () => void;
  onLoadDemo: () => void;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onSetIn: () => void;
  onSetOut: () => void;
}

export function PreviewStage({
  canvasRef,
  ratio,
  safeZone,
  onSafeZoneChange,
  faceBox,
  faceTrackingEnabled,
  showFaceGuide,
  onToggleFaceGuide,
  hasMediaOrDemo,
  isPlaying,
  loop,
  currentTime,
  duration,
  panX,
  panY,
  onPanChange,
  onDropFile,
  onChooseVideo,
  onLoadDemo,
  onTogglePlay,
  onToggleLoop,
  onSetIn,
  onSetOut,
}: PreviewStageProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const dims = getCanvasDimensions(ratio);
  const aspectClass =
    ratio === '16:9'
      ? 'w-full max-w-full aspect-video max-h-full'
      : ratio === '1:1'
      ? 'h-full max-h-full aspect-square'
      : 'h-full max-h-full aspect-[9/16]';

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!hasMediaOrDemo) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const nextX = Math.max(-100, Math.min(100, Math.round(dragStartRef.current.panX + dx * 0.45)));
    const nextY = Math.max(-100, Math.min(100, Math.round(dragStartRef.current.panY + dy * 0.45)));
    onPanChange(nextX, nextY);
  };

  const handlePointerUp = () => {
    dragStartRef.current = null;
  };

  return (
    <main className="flex-1 min-w-0 flex flex-col items-center justify-between py-3 px-4 bg-[#080a0e] relative">
      {/* Safe Zone Guide Switcher */}
      <div className="flex items-center gap-1 bg-[#12151c]/95 border border-white/[0.07] p-1 rounded-xl z-10">
        <span className="text-[11px] font-medium text-slate-400 px-2.5 whitespace-nowrap">
          Zonas seguras
        </span>
        {(
          [
            { id: 'none', label: 'Limpias' },
            { id: 'tiktok', label: 'TikTok' },
            { id: 'shorts', label: 'YT Shorts' },
            { id: 'grid', label: 'Rejilla 3×3' },
          ] as Array<{ id: SafeZoneMode; label: string }>
        ).map((sz) => (
          <button
            key={sz.id}
            type="button"
            onClick={() => onSafeZoneChange(sz.id)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              safeZone === sz.id
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {sz.label}
          </button>
        ))}
        <span className="h-4 w-px bg-white/[0.08] mx-0.5" aria-hidden="true" />
        <button
          type="button"
          onClick={onToggleFaceGuide}
          title="Mostrar u ocultar guía visual del seguimiento de rostro (no se exporta)"
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
            showFaceGuide && faceTrackingEnabled
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35'
              : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          <ScanFace className="w-3.5 h-3.5" />
          <span>Guía Rostro</span>
        </button>
      </div>

      {/* Responsive Ratio Viewport */}
      <div className="flex-1 min-h-0 w-full flex items-center justify-center py-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onDropFile(file);
          }}
          className={`relative ${aspectClass} bg-black rounded-2xl overflow-hidden shadow-2xl border transition-colors ${
            isDragOver ? 'border-blue-500 ring-2 ring-blue-500/35' : 'border-white/[0.08]'
          }`}
        >
          <canvas
            ref={canvasRef}
            width={dims.width}
            height={dims.height}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={`w-full h-full block ${hasMediaOrDemo ? 'cursor-grab active:cursor-grabbing' : ''}`}
          />

          {/* Empty State Overlay */}
          {!hasMediaOrDemo && (
            <div className="absolute inset-0 bg-[#0b0d12]/92 flex flex-col items-center justify-center text-center p-6 gap-4 z-10">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/12 flex items-center justify-center">
                <Film className="w-6 h-6 text-blue-400" />
              </div>
              <div className="space-y-1.5 max-w-[230px]">
                <h3 className="text-sm font-semibold text-white">
                  Sube tu video o inicia con el demo
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Arrastra un archivo MP4, MOV o WebM para editarlo en tiempo real.
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-[200px]">
                <button
                  type="button"
                  onClick={onChooseVideo}
                  className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Elegir Video</span>
                </button>
                <button
                  type="button"
                  onClick={onLoadDemo}
                  className="inline-flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#222836] transition-colors cursor-pointer"
                >
                  <span>Probar Clip Demo</span>
                </button>
              </div>
            </div>
          )}

          {/* Face Tracking Reticle Overlay (Never Exported) */}
          {showFaceGuide && faceTrackingEnabled && faceBox && hasMediaOrDemo && (
            <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
              <div
                style={{
                  left: `${faceBox.xPct}%`,
                  top: `${faceBox.yPct}%`,
                  width: `${Math.max(8, faceBox.wPct)}%`,
                  height: `${Math.max(8, faceBox.hPct)}%`,
                }}
                className="absolute border-2 border-emerald-400/90 rounded-lg transition-[left,top,width,height] duration-75"
              >
                <span className="absolute -top-5 left-0 bg-emerald-500 text-slate-950 text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap font-mono-tabular">
                  Rostro {Math.round(faceBox.confidence * 100)}%
                </span>
              </div>
            </div>
          )}

          {/* Safe Zones Overlay (Never Exported) */}
          {safeZone !== 'none' && (
            <div className="absolute inset-0 pointer-events-none z-20">
              {safeZone === 'grid' && (
                <>
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage:
                        'linear-gradient(to right, rgba(255,255,255,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.16) 1px, transparent 1px)',
                      backgroundSize: '33.333% 33.333%',
                    }}
                  />
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-400/60" />
                </>
              )}

              {safeZone === 'tiktok' && (
                <>
                  <div className="absolute top-0 left-0 right-0 h-[11%] bg-rose-500/20 border-b border-dashed border-rose-400/80 flex items-center justify-center text-[10px] font-semibold text-white/90">
                    TikTok Superior
                  </div>
                  <div className="absolute right-[2%] bottom-[14%] w-[16%] h-[42%] bg-rose-500/20 border border-dashed border-rose-400/80 flex items-center justify-center text-[10px] font-semibold text-white/90 text-center px-1">
                    Botones
                  </div>
                  <div className="absolute left-0 bottom-0 right-[19%] h-[22%] bg-rose-500/20 border-t border-r border-dashed border-rose-400/80 flex items-center justify-center text-[10px] font-semibold text-white/90">
                    Descripción y Audio
                  </div>
                </>
              )}

              {safeZone === 'shorts' && (
                <>
                  <div className="absolute top-0 left-0 right-0 h-[9%] bg-rose-500/20 border-b border-dashed border-rose-400/80 flex items-center justify-center text-[10px] font-semibold text-white/90">
                    Shorts Superior
                  </div>
                  <div className="absolute right-[2%] bottom-[11%] w-[16%] h-[42%] bg-rose-500/20 border border-dashed border-rose-400/80 flex items-center justify-center text-[10px] font-semibold text-white/90 text-center px-1">
                    Acciones
                  </div>
                  <div className="absolute left-0 bottom-0 right-[19%] h-[19%] bg-rose-500/20 border-t border-r border-dashed border-rose-400/80 flex items-center justify-center text-[10px] font-semibold text-white/90">
                    Canal y Título
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Transport Controls */}
      <div className="flex items-center gap-2 bg-[#12151c] border border-white/[0.07] px-3 py-1.5 rounded-xl">
        <button
          type="button"
          onClick={onSetIn}
          title="Marcar inicio (Tecla I)"
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors whitespace-nowrap cursor-pointer"
        >
          [ In
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          className="inline-flex items-center justify-center gap-1.5 min-w-[92px] px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors whitespace-nowrap cursor-pointer"
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isPlaying ? 'Pausa' : 'Play'}</span>
        </button>

        <button
          type="button"
          onClick={onSetOut}
          title="Marcar fin (Tecla O)"
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors whitespace-nowrap cursor-pointer"
        >
          Out ]
        </button>

        <span className="px-2 text-xs font-mono-tabular text-slate-400 whitespace-nowrap">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <button
          type="button"
          onClick={onToggleLoop}
          title="Reproducción en bucle"
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
            loop
              ? 'bg-blue-600/20 text-blue-300 border border-blue-500/35'
              : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.05]'
          }`}
        >
          <Repeat className="w-3.5 h-3.5" />
          <span>Loop</span>
        </button>
      </div>
    </main>
  );
}
