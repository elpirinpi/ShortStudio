import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  Download,
  FileText,
  FolderOpen,
  Layers,
  LoaderCircle,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { ClipProject, GeneratedClip } from '../types/editor';
import { getEffectiveOutputDuration } from '../utils/clipTiming';
import { exportSubtitlesToSRT, formatTime } from '../utils/srt';

interface ResultsPageProps {
  project: ClipProject | null;
  mediaUrl: string | null;
  retranscribing?: boolean;
  retranscribeStatus?: string;
  compactingClipId?: string | null;
  onRetranscribeProject?: (projectId: string) => void;
  onOpenManualClipModal?: (projectId: string) => void;
  onOpenBatchExport?: (projectId: string) => void;
  onToggleClipSilenceCut?: (projectId: string, clipId: string) => void;
  onRelinkMedia?: (projectId: string, file: File) => void;
  onRenameClip?: (projectId: string, clipId: string, title: string) => void;
  onDeleteClip?: (projectId: string, clipId: string) => void;
  onEditClipInStudio: (projectId: string, clipId: string) => void;
  onScheduleClip: (projectId: string, clipId: string) => void;
  onBackToProjects: () => void;
}

function ClipPreviewPlayer({
  clip,
  mediaUrl,
  isDemo,
}: {
  clip: GeneratedClip;
  mediaUrl: string | null;
  isDemo: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !mediaUrl) return;
    v.currentTime = clip.start;
  }, [clip.start, mediaUrl]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v || !mediaUrl) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      if (v.currentTime < clip.start || v.currentTime >= clip.end - 0.1) {
        v.currentTime = clip.start;
      }
      v.play().catch(() => {});
      setPlaying(true);
    }
  };

  if (isDemo || !mediaUrl) {
    return (
      <div className="aspect-[9/16] w-full max-w-[172px] bg-[#0b0d12] border border-white/[0.06] rounded-xl p-3.5 flex flex-col justify-between shrink-0">
        <span className="text-[10px] font-mono-tabular text-slate-400">
          {formatTime(clip.start)} – {formatTime(clip.end)}
        </span>
        <div className="space-y-1.5 text-center">
          <Sparkles className="w-5 h-5 text-blue-400 mx-auto" />
          <p className="text-[11px] font-semibold text-slate-200">Vista Demo 9:16</p>
          <p className="text-[10px] text-slate-400">Abre en ShortStudio para vista 60fps</p>
        </div>
        <span className="text-[10px] font-mono-tabular text-slate-500 text-center">
          {clip.editorSettings.ratio}
        </span>
      </div>
    );
  }

  return (
    <div className="aspect-[9/16] w-full max-w-[172px] bg-black border border-white/[0.06] rounded-xl overflow-hidden relative shrink-0 group">
      <video
        ref={videoRef}
        src={mediaUrl}
        playsInline
        onTimeUpdate={() => {
          const v = videoRef.current;
          if (!v) return;
          if (v.currentTime >= clip.end) {
            v.currentTime = clip.start;
          }
        }}
        className="w-full h-full object-cover"
      />
      <button
        type="button"
        onClick={toggle}
        className="absolute inset-0 bg-black/25 hover:bg-black/40 flex items-center justify-center transition-colors cursor-pointer"
        aria-label={playing ? 'Pausar clip' : 'Reproducir clip'}
      >
        <span className="w-10 h-10 rounded-full bg-black/75 border border-white/15 flex items-center justify-center text-white">
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </span>
      </button>
      <div className="absolute bottom-2 left-2 right-2 text-[10px] font-mono-tabular text-white bg-black/75 px-2 py-0.5 rounded-md text-center pointer-events-none">
        {formatTime(clip.start)} → {formatTime(clip.end)}
      </div>
    </div>
  );
}

export function ResultsPage({
  project,
  mediaUrl,
  retranscribing = false,
  retranscribeStatus = '',
  compactingClipId = null,
  onRetranscribeProject,
  onOpenManualClipModal,
  onOpenBatchExport,
  onToggleClipSilenceCut,
  onRelinkMedia,
  onRenameClip,
  onDeleteClip,
  onEditClipInStudio,
  onScheduleClip,
  onBackToProjects,
}: ResultsPageProps) {
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [draftClipTitle, setDraftClipTitle] = useState('');
  const [confirmDeleteClipId, setConfirmDeleteClipId] = useState<string | null>(null);
  const relinkInputRef = useRef<HTMLInputElement | null>(null);

  if (!project) {
    return (
      <main className="flex-1 overflow-y-auto bg-[#0b0d12] p-6 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-sm font-semibold text-slate-200">No hay ningún proyecto activo</p>
          <button
            type="button"
            onClick={onBackToProjects}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer"
          >
            Ir a Mis Proyectos
          </button>
        </div>
      </main>
    );
  }

  const downloadClipSrt = (clip: GeneratedClip) => {
    const content = exportSubtitlesToSRT(clip.subtitles);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clip.title.slice(0, 28).replace(/\s+/g, '_')}.srt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const downloadAllScriptsTxt = () => {
    const lines: string[] = [
      `PROYECTO: ${project.title}`,
      `MOTOR: ${project.aiEngineUsed}`,
      `CLIPS: ${project.clips.length}`,
      '',
    ];
    project.clips.forEach((c, idx) => {
      lines.push(
        `=== CLIP #${idx + 1}: ${c.title} (${formatTime(c.start)} - ${formatTime(c.end)} · Score ${c.score}/100) ===`
      );
      lines.push(`Motivo viral: ${c.viralReason}`);
      lines.push(`Palabras clave: ${c.keywords.join(', ')}`);
      lines.push(`Guion: ${c.transcriptSnippet}`);
      lines.push('');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.title.slice(0, 28).replace(/\s+/g, '_')}_Guiones.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const bestScore = project.clips.reduce((acc, c) => Math.max(acc, c.score), 0);
  const avgDuration =
    project.clips.length > 0
      ? project.clips.reduce((acc, c) => acc + c.duration, 0) / project.clips.length
      : 0;
  const totalSubtitleBlocks = project.clips.reduce((acc, c) => acc + c.subtitles.length, 0);

  return (
    <main className="flex-1 overflow-y-auto bg-[#0b0d12] p-6 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-7">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.06] pb-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Resultados del análisis</span>
              <span aria-hidden="true">·</span>
              <span>{project.aiEngineUsed}</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">{project.title}</h1>
            <div className="flex items-center gap-2 text-xs font-mono-tabular text-slate-400">
              <span>{project.clips.length} clips detectados</span>
              <span aria-hidden="true">·</span>
              <span>Duración fuente {formatTime(project.duration)}</span>
              <span aria-hidden="true">·</span>
              <span>Formato {project.config.ratio}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenManualClipModal && (
              <button
                type="button"
                onClick={() => onOpenManualClipModal(project.id)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer whitespace-nowrap transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nuevo Clip Manual</span>
              </button>
            )}
            {onOpenBatchExport && (
              <button
                type="button"
                disabled={project.clips.length === 0 || (!project.isDemo && !mediaUrl)}
                onClick={() => onOpenBatchExport(project.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-emerald-300 bg-emerald-500/12 border border-emerald-500/25 hover:bg-emerald-500/20 disabled:opacity-40 cursor-pointer whitespace-nowrap transition-colors"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Exportar Lote (.MP4)</span>
              </button>
            )}
            {!project.isDemo && onRetranscribeProject && (
              <button
                type="button"
                disabled={retranscribing}
                onClick={() => onRetranscribeProject(project.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-200 bg-[#161a23] border border-white/[0.06] hover:bg-[#1e2330] disabled:opacity-45 cursor-pointer whitespace-nowrap transition-colors"
              >
                {retranscribing ? (
                  <LoaderCircle className="w-3.5 h-3.5 animate-spin text-blue-400" />
                ) : (
                  <Mic className="w-3.5 h-3.5 text-blue-400" />
                )}
                <span>
                  {retranscribing
                    ? retranscribeStatus || 'Transcribiendo...'
                    : 'Transcribir con Whisper Local'}
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={project.clips.length === 0}
              onClick={downloadAllScriptsTxt}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-200 bg-[#161a23] border border-white/[0.06] hover:bg-[#1e2330] disabled:opacity-40 cursor-pointer whitespace-nowrap transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span>Exportar Guiones .TXT</span>
            </button>
            <button
              type="button"
              onClick={onBackToProjects}
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.05] cursor-pointer whitespace-nowrap transition-colors"
            >
              Proyectos
            </button>
          </div>
        </div>

        {/* 4-column Summary Strip */}
        <section className="grid grid-cols-2 md:grid-cols-4 bg-[#12151c] border border-white/[0.06] rounded-2xl divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">
          <div className="p-5 space-y-1">
            <div className="text-[11px] text-slate-400">Clips generados</div>
            <div className="text-lg font-bold font-mono-tabular text-white">
              {project.clips.length}
            </div>
          </div>
          <div className="p-5 space-y-1">
            <div className="text-[11px] text-slate-400">Mejor puntuación viral</div>
            <div className="text-lg font-bold font-mono-tabular text-emerald-400">
              {bestScore}/100
            </div>
          </div>
          <div className="p-5 space-y-1">
            <div className="text-[11px] text-slate-400">Duración promedio</div>
            <div className="text-lg font-bold font-mono-tabular text-white">
              {avgDuration.toFixed(1)}s
            </div>
          </div>
          <div className="p-5 space-y-1">
            <div className="text-[11px] text-slate-400">Bloques de subtítulo</div>
            <div className="text-lg font-bold font-mono-tabular text-white">
              {totalSubtitleBlocks}
            </div>
          </div>
        </section>

        {/* Full Video Transcript */}
        {project.transcript.length > 0 && (
          <section className="bg-[#12151c] border border-white/[0.06] rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-slate-200">
                Transcripción completa ({project.transcript.length} segmentos)
              </h2>
              <span className="text-[11px] font-mono-tabular text-slate-400">
                Idioma: {project.config.language.toUpperCase()}
              </span>
            </div>
            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {project.transcript.map((seg, idx) => (
                <div
                  key={`${seg.start}_${idx}`}
                  className="flex items-baseline gap-3 text-xs leading-relaxed"
                >
                  <span className="font-mono-tabular text-[11px] text-blue-400 shrink-0">
                    {formatTime(seg.start)}
                  </span>
                  <span className="text-slate-300">{seg.text}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {!project.isDemo && !mediaUrl && onRelinkMedia && (
          <section className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold text-amber-100">
                  Video original no encontrado en este dispositivo
                </p>
                <p className="text-[11px] text-amber-200/80">
                  Tus clips, cortes y subtítulos siguen guardados. Re-vincula el archivo «{project.mediaName}» desde tu PC para previsualizar y exportar.
                </p>
              </div>
            </div>
            <input
              ref={relinkInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onRelinkMedia(project.id, file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => relinkInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 cursor-pointer whitespace-nowrap"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Re-vincular video desde PC</span>
            </button>
          </section>
        )}

        <div className="space-y-5">
          {project.clips.length === 0 && (
            <div className="bg-[#12151c] border border-dashed border-white/[0.12] rounded-2xl p-10 text-center space-y-3">
              <Scissors className="w-7 h-7 text-blue-400 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">
                  Aún no hay clips en este proyecto
                </p>
                <p className="text-xs text-slate-400">
                  Selecciona manualmente los momentos exactos de tu video para crear tus Shorts 9:16.
                </p>
              </div>
              {onOpenManualClipModal && (
                <button
                  type="button"
                  onClick={() => onOpenManualClipModal(project.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Crear Primer Clip Manual</span>
                </button>
              )}
            </div>
          )}

          {project.clips.map((clip, idx) => {
            const breakdownItems = [
              { label: 'Energía Vocal', value: clip.signalBreakdown.vocalEnergy },
              { label: 'Ritmo y Cortes', value: clip.signalBreakdown.pacing },
              { label: 'Gancho 3s', value: clip.signalBreakdown.hookStrength },
              { label: 'Dinámica Visual', value: clip.signalBreakdown.visualDynamics },
            ];

            return (
              <article
                key={clip.id}
                className="bg-[#12151c] border border-white/[0.06] hover:border-white/[0.1] transition-colors rounded-2xl p-6 flex flex-col md:flex-row gap-7"
              >
                <ClipPreviewPlayer
                  clip={clip}
                  mediaUrl={mediaUrl}
                  isDemo={project.isDemo}
                />

                <div className="flex-1 min-w-0 flex flex-col justify-between gap-5">
                  <div className="space-y-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-mono-tabular text-slate-400">
                          <span>Clip #{idx + 1}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {getEffectiveOutputDuration(clip.editorSettings).toFixed(1)}s
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{clip.subtitles.length} bloques de subtítulo</span>
                          {clip.editorSettings.silenceCutEnabled && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-400">Sin silencios</span>
                            </>
                          )}
                          {clip.editorSettings.hookEnabled && clip.editorSettings.hookText && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-blue-400">Gancho superior</span>
                            </>
                          )}
                          {clip.editorSettings.faceTracking &&
                            clip.editorSettings.faceKeyframes?.length > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-400">
                                  Rostro seguido ({clip.editorSettings.faceKeyframes.length} pts)
                                </span>
                              </>
                            )}
                        </div>
                        {editingClipId === clip.id ? (
                          <div className="flex items-center gap-1.5 pt-0.5">
                            <input
                              type="text"
                              value={draftClipTitle}
                              autoFocus
                              onChange={(e) => setDraftClipTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (draftClipTitle.trim()) {
                                    onRenameClip?.(project.id, clip.id, draftClipTitle.trim());
                                  }
                                  setEditingClipId(null);
                                }
                                if (e.key === 'Escape') setEditingClipId(null);
                              }}
                              className="bg-[#0b0d12] border border-blue-500/70 rounded-lg px-2.5 py-1 text-sm text-slate-100 focus:outline-none min-w-[240px]"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (draftClipTitle.trim()) {
                                  onRenameClip?.(project.id, clip.id, draftClipTitle.trim());
                                }
                                setEditingClipId(null);
                              }}
                              className="p-1 rounded-md text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingClipId(null)}
                              className="p-1 rounded-md text-slate-400 hover:bg-white/[0.06] cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <h2 className="text-base font-semibold text-white">{clip.title}</h2>
                            {onRenameClip && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingClipId(clip.id);
                                  setDraftClipTitle(clip.title);
                                }}
                                title="Renombrar clip"
                                className="p-1 rounded text-slate-500 hover:text-slate-200 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[11px] text-slate-400">Puntuación Viral</div>
                        <div
                          className={`text-2xl font-bold font-mono-tabular ${
                            clip.score >= 85
                              ? 'text-emerald-400'
                              : clip.score >= 70
                              ? 'text-amber-400'
                              : 'text-slate-200'
                          }`}
                        >
                          {clip.score}/100
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">{clip.viralReason}</p>

                    {/* Signal Breakdown Bars */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-3 border-y border-white/[0.06]">
                      {breakdownItems.map((metric) => (
                        <div key={metric.label} className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400">{metric.label}</span>
                            <span className="font-mono-tabular text-slate-200">
                              {metric.value.toFixed(1)}
                            </span>
                          </div>
                          <div className="h-1.5 bg-[#0b0d12] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${Math.min(100, metric.value * 10)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium text-slate-400">
                        Transcripción del fragmento
                      </div>
                      <p className="text-xs text-slate-300 bg-[#0b0d12]/75 rounded-xl p-3.5 leading-relaxed">
                        {clip.transcriptSnippet}
                      </p>
                    </div>

                    <div className="text-[11px] text-slate-400">
                      Palabras clave:{' '}
                      <span className="text-slate-200">{clip.keywords.join(' · ')}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => onEditClipInStudio(project.id, clip.id)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer whitespace-nowrap transition-colors"
                    >
                      <Scissors className="w-3.5 h-3.5" />
                      <span>Editar y Exportar en ShortStudio</span>
                    </button>
                    {onToggleClipSilenceCut && (
                      <button
                        type="button"
                        disabled={
                          compactingClipId === clip.id || (!project.isDemo && !mediaUrl)
                        }
                        onClick={() => onToggleClipSilenceCut(project.id, clip.id)}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium cursor-pointer whitespace-nowrap disabled:opacity-45 transition-colors ${
                          clip.editorSettings.silenceCutEnabled
                            ? 'text-emerald-300 bg-emerald-500/12 border border-emerald-500/30 hover:bg-emerald-500/20'
                            : 'text-slate-200 bg-[#181c25] hover:bg-[#202633]'
                        }`}
                      >
                        {compactingClipId === clip.id ? (
                          <LoaderCircle className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        ) : (
                          <Scissors className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                        <span>
                          {compactingClipId === clip.id
                            ? 'Analizando...'
                            : clip.editorSettings.silenceCutEnabled
                            ? 'Silencios Recortados'
                            : 'Compactar Silencios'}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onScheduleClip(project.id, clip.id)}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#202633] cursor-pointer whitespace-nowrap transition-colors"
                    >
                      <Calendar className="w-3.5 h-3.5 text-blue-400" />
                      <span>Programar Publicación</span>
                    </button>
                    <button
                      type="button"
                      disabled={clip.subtitles.length === 0}
                      onClick={() => downloadClipSrt(clip)}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#202633] disabled:opacity-40 cursor-pointer whitespace-nowrap transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-400" />
                      <span>Descargar .SRT</span>
                    </button>
                    {onDeleteClip && (
                      confirmDeleteClipId === clip.id ? (
                        <div className="inline-flex items-center gap-1.5 ml-auto">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteClipId(null);
                              onDeleteClip(project.id, clip.id);
                            }}
                            className="px-3 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer whitespace-nowrap"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteClipId(null)}
                            className="px-3 py-2 rounded-xl text-xs font-medium text-slate-300 bg-[#181c25] hover:bg-[#202633] cursor-pointer whitespace-nowrap"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteClipId(clip.id)}
                          title="Eliminar este clip"
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-300 hover:bg-rose-500/12 cursor-pointer whitespace-nowrap ml-auto transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Eliminar</span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
