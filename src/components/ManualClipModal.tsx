import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  LoaderCircle,
  Pause,
  Play,
  Scissors,
  Sparkles,
  X,
} from 'lucide-react';
import { ClipProject } from '../types/editor';
import { formatTime } from '../utils/srt';

interface ManualClipModalProps {
  open: boolean;
  project: ClipProject | null;
  mediaUrl: string | null;
  creating: boolean;
  progressPercent: number;
  progressLabel: string;
  errorMsg: string;
  onClose: () => void;
  onCreateClip: (params: {
    projectId: string;
    start: number;
    end: number;
    title: string;
    transcribeAudio: boolean;
    trackFaces: boolean;
    openInEditor: boolean;
  }) => Promise<void>;
}

export function ManualClipModal({
  open,
  project,
  mediaUrl,
  creating,
  progressPercent,
  progressLabel,
  errorMsg,
  onClose,
  onCreateClip,
}: ManualClipModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const totalDuration = Math.max(1, project?.duration || 12);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(Math.min(30, totalDuration));
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopPreview, setLoopPreview] = useState(true);
  const [title, setTitle] = useState('');
  const [transcribeAudio, setTranscribeAudio] = useState(false);
  const [trackFaces, setTrackFaces] = useState(false);

  useEffect(() => {
    if (!open || !project) return;
    const dur = Math.max(1, project.duration || 12);
    // Suggest starting after the last clip if there is room, otherwise 0
    const lastEnd =
      project.clips.length > 0
        ? Math.max(...project.clips.map((c) => c.end))
        : 0;
    const suggestedStart = lastEnd + 2 < dur ? Number(lastEnd.toFixed(1)) : 0;
    const suggestedEnd = Number(Math.min(dur, suggestedStart + 30).toFixed(1));
    setStartSec(suggestedStart);
    setEndSec(Math.max(Number(Math.min(dur, suggestedStart + 1).toFixed(1)), suggestedEnd));
    setCurrentTime(suggestedStart);
    setPlaying(false);
    setTitle('');
    setTranscribeAudio(false);
    setTrackFaces(false);
    if (videoRef.current && mediaUrl) {
      videoRef.current.pause();
      videoRef.current.currentTime = suggestedStart;
    }
  }, [open, project?.id]);

  if (!open || !project) return null;

  const seekTo = (t: number) => {
    const clamped = Math.max(0, Math.min(totalDuration, t));
    setCurrentTime(clamped);
    if (videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || !mediaUrl || project.isDemo) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      if (v.currentTime < startSec || v.currentTime >= endSec - 0.1) {
        v.currentTime = startSec;
      }
      v.play().catch(() => {});
      setPlaying(true);
    }
  };

  const clampStart = (val: number) => {
    const safe = Number(Math.max(0, Math.min(endSec - 0.5, val)).toFixed(1));
    setStartSec(safe);
    seekTo(safe);
  };

  const clampEnd = (val: number) => {
    const safe = Number(Math.min(totalDuration, Math.max(startSec + 0.5, val)).toFixed(1));
    setEndSec(safe);
  };

  const applyDurationPreset = (lenSec: number | 'all') => {
    if (lenSec === 'all') {
      setStartSec(0);
      setEndSec(Number(totalDuration.toFixed(1)));
      seekTo(0);
      return;
    }
    const nextEnd = Number(Math.min(totalDuration, startSec + lenSec).toFixed(1));
    if (nextEnd - startSec < 0.5) {
      const nextStart = Number(Math.max(0, totalDuration - lenSec).toFixed(1));
      setStartSec(nextStart);
      setEndSec(Number(totalDuration.toFixed(1)));
      seekTo(nextStart);
    } else {
      setEndSec(nextEnd);
    }
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(Number((ratio * totalDuration).toFixed(1)));
  };

  const clipDuration = Math.max(0.5, Number((endSec - startSec).toFixed(1)));
  const startPct = (startSec / totalDuration) * 100;
  const widthPct = Math.max(1, ((endSec - startSec) / totalDuration) * 100);
  const playheadPct = (currentTime / totalDuration) * 100;

  const existingTranscriptMatches = project.transcript.filter(
    (seg) => seg.end >= startSec && seg.start <= endSec
  ).length;

  const handleSubmit = async (openInEditor: boolean) => {
    if (creating) return;
    if (videoRef.current && playing) {
      videoRef.current.pause();
      setPlaying(false);
    }
    await onCreateClip({
      projectId: project.id,
      start: startSec,
      end: endSec,
      title,
      transcribeAudio,
      trackFaces,
      openInEditor,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-3xl bg-[#12151c] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden my-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Scissors className="w-4 h-4 text-blue-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white truncate">
                Crear Clip Manualmente
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                {project.title} · Duración total {formatTime(totalDuration)}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={creating}
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 cursor-pointer"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Interactive Video Preview */}
          <div className="bg-[#0b0d12] rounded-xl overflow-hidden">
            {mediaUrl && !project.isDemo ? (
              <div className="relative aspect-video max-h-[280px] w-full bg-black flex items-center justify-center">
                <video
                  ref={videoRef}
                  src={mediaUrl}
                  playsInline
                  onLoadedMetadata={() => {
                    if (videoRef.current) {
                      videoRef.current.currentTime = startSec;
                    }
                  }}
                  onTimeUpdate={() => {
                    const v = videoRef.current;
                    if (!v) return;
                    setCurrentTime(v.currentTime);
                    if (playing && loopPreview && v.currentTime >= endSec) {
                      v.currentTime = startSec;
                    }
                  }}
                  onEnded={() => setPlaying(false)}
                  className="w-full h-full object-contain"
                />
                <button
                  type="button"
                  onClick={togglePlay}
                  className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-black/75 border border-white/15 hover:bg-black/90 cursor-pointer"
                >
                  {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{playing ? 'Pausar' : 'Reproducir fragmento'}</span>
                </button>
                <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-md text-[11px] font-mono-tabular text-slate-100 bg-black/75 border border-white/10">
                  {formatTime(currentTime)} / {formatTime(totalDuration)}
                </div>
              </div>
            ) : (
              <div className="h-32 flex flex-col items-center justify-center gap-1.5 text-center px-4">
                <Sparkles className="w-5 h-5 text-blue-400" />
                <p className="text-xs font-medium text-slate-200">
                  Selector de rango de tiempo ({formatTime(startSec)} → {formatTime(endSec)})
                </p>
                <p className="text-[11px] text-slate-400">
                  Define el punto de inicio y fin exacto para tu clip.
                </p>
              </div>
            )}

            {/* Interactive Range Track */}
            <div className="p-3.5 space-y-2.5 border-t border-white/[0.06]">
              <div
                ref={trackRef}
                onClick={handleTrackClick}
                title="Haz clic para mover el cabezal de reproducción"
                className="relative h-7 bg-[#141821] rounded-lg cursor-pointer overflow-hidden"
              >
                <div
                  className="absolute top-0 bottom-0 bg-blue-600/35 border-x-2 border-blue-400"
                  style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white shadow"
                  style={{ left: `${playheadPct}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => clampStart(currentTime)}
                    className="px-2.5 py-1 rounded-lg font-medium bg-[#181c25] text-slate-200 hover:bg-[#222836] cursor-pointer"
                  >
                    Marcar Inicio ({formatTime(currentTime)})
                  </button>
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => clampEnd(currentTime)}
                    className="px-2.5 py-1 rounded-lg font-medium bg-[#181c25] text-slate-200 hover:bg-[#222836] cursor-pointer"
                  >
                    Marcar Fin ({formatTime(currentTime)})
                  </button>
                </div>

                <label className="inline-flex items-center gap-1.5 text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={loopPreview}
                    onChange={(e) => setLoopPreview(e.target.checked)}
                    className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
                  />
                  <span>Repetir selección</span>
                </label>
              </div>
            </div>
          </div>

          {/* Exact Start / End Controls + Quick Duration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-[#0b0d12] rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">Inicio (seg)</span>
                <span className="font-mono-tabular text-blue-400">{formatTime(startSec)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => clampStart(startSec - 1)}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-[#181c25] text-slate-300 hover:bg-[#222836] cursor-pointer"
                >
                  -1s
                </button>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  max={Math.max(0, endSec - 0.5)}
                  value={startSec}
                  disabled={creating}
                  onChange={(e) => clampStart(Number(e.target.value) || 0)}
                  className="flex-1 min-w-0 bg-[#12151c] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-blue-500/70"
                />
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => clampStart(startSec + 1)}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-[#181c25] text-slate-300 hover:bg-[#222836] cursor-pointer"
                >
                  +1s
                </button>
              </div>
            </div>

            <div className="bg-[#0b0d12] rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">Fin (seg)</span>
                <span className="font-mono-tabular text-blue-400">
                  {formatTime(endSec)} · Duración {clipDuration.toFixed(1)}s
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => clampEnd(endSec - 1)}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-[#181c25] text-slate-300 hover:bg-[#222836] cursor-pointer"
                >
                  -1s
                </button>
                <input
                  type="number"
                  step="0.5"
                  min={startSec + 0.5}
                  max={totalDuration}
                  value={endSec}
                  disabled={creating}
                  onChange={(e) => clampEnd(Number(e.target.value) || totalDuration)}
                  className="flex-1 min-w-0 bg-[#12151c] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-blue-500/70"
                />
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => clampEnd(endSec + 1)}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-[#181c25] text-slate-300 hover:bg-[#222836] cursor-pointer"
                >
                  +1s
                </button>
              </div>
            </div>
          </div>

          {/* Quick Length Presets + Title */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-5 space-y-1.5">
              <span className="text-[11px] text-slate-400 block">Duración rápida desde inicio</span>
              <div className="grid grid-cols-5 gap-1">
                {([15, 30, 45, 60, 'all'] as const).map((len) => (
                  <button
                    key={String(len)}
                    type="button"
                    disabled={creating}
                    onClick={() => applyDurationPreset(len)}
                    className="py-1.5 rounded-lg text-[11px] font-medium bg-[#181c25] text-slate-300 hover:bg-blue-600 hover:text-white cursor-pointer transition-colors"
                  >
                    {len === 'all' ? 'Todo' : `${len}s`}
                  </button>
                ))}
              </div>
            </div>

            <label className="md:col-span-7 flex flex-col gap-1.5">
              <span className="text-[11px] text-slate-400">Título del clip (opcional)</span>
              <input
                type="text"
                value={title}
                disabled={creating}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`Clip Manual #${project.clips.length + 1} (${Math.floor(startSec)}s–${Math.ceil(endSec)}s)`}
                className="w-full bg-[#0b0d12] border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
              />
            </label>
          </div>

          {/* Optional AI Enhancements for this manual clip */}
          <div className="bg-[#0b0d12] rounded-xl p-3.5 space-y-2.5">
            {existingTranscriptMatches > 0 ? (
              <p className="text-[11px] text-emerald-400">
                Subtítulos listos: se reutilizarán automáticamente {existingTranscriptMatches}{' '}
                segmentos de la transcripción del proyecto.
              </p>
            ) : !project.isDemo && mediaUrl ? (
              <label className="flex items-center justify-between gap-2 text-xs text-slate-300 cursor-pointer">
                <span>Generar subtítulos automáticos con Whisper local</span>
                <input
                  type="checkbox"
                  checked={transcribeAudio}
                  disabled={creating}
                  onChange={(e) => setTranscribeAudio(e.target.checked)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
              </label>
            ) : null}

            <label className="flex items-center justify-between gap-2 text-xs text-slate-300 cursor-pointer">
              <span>Detectar y seguir rostro automáticamente en este clip</span>
              <input
                type="checkbox"
                checked={trackFaces}
                disabled={creating}
                onChange={(e) => setTrackFaces(e.target.checked)}
                className="w-4 h-4 accent-blue-500 cursor-pointer"
              />
            </label>
          </div>

          {creating && (
            <div className="bg-[#0b0d12] border border-blue-500/35 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-2 text-slate-200">
                  <LoaderCircle className="w-3.5 h-3.5 animate-spin text-blue-400" />
                  <span>{progressLabel || 'Creando clip manual...'}</span>
                </span>
                <span className="font-mono-tabular text-blue-400">{progressPercent}%</span>
              </div>
              <div className="h-1.5 bg-[#161a24] rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-[width] duration-200"
                  style={{ width: `${Math.max(4, progressPercent)}%` }}
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-[#0e1118] border-t border-white/[0.06] flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={creating}
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-300 bg-[#181c25] hover:bg-[#222836] disabled:opacity-45 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={() => handleSubmit(false)}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-100 bg-[#181c25] hover:bg-[#222836] disabled:opacity-45 cursor-pointer"
          >
            Agregar a Resultados
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={() => handleSubmit(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-45 cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Crear y Abrir en Editor</span>
          </button>
        </div>
      </div>
    </div>
  );
}
