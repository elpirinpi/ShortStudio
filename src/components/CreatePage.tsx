import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  FileVideo,
  FolderDown,
  Link2,
  LoaderCircle,
  Play,
  Scissors,
  Upload,
  Video,
  X,
} from 'lucide-react';
import {
  AiEngineMode,
  AppSettings,
  FitMode,
  ProjectConfig,
  SubtitlePresetId,
  TargetDuration,
  TargetRatio,
} from '../types/editor';
import { formatTime } from '../utils/srt';
import { ConnectorStatus, isRunningInIframe } from '../utils/windowsConnector';

export interface StagedMediaInfo {
  file: File | Blob;
  name: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  thumbnailDataUrl: string | null;
  savedPcPath?: string;
}

interface CreatePageProps {
  stagedMedia: StagedMediaInfo | null;
  config: ProjectConfig;
  appSettings: AppSettings;
  analyzing: boolean;
  analysisProgress: number;
  analysisStep: string;
  errorMsg: string;
  connectorStatus: ConnectorStatus;
  urlStatusText?: string;
  urlProgressPercent?: number;
  onSelectFile: (file: File) => void;
  onOpenRecorder: () => void;
  onImportUrl: (url: string) => Promise<boolean>;
  onCancelImportUrl?: () => void;
  onDownloadConnectorLauncher: () => void;
  onSaveStagedToPc: () => void;
  onUpdateConfig: <K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K]) => void;
  onChangeAiEngine: (engine: AiEngineMode) => void;
  onAnalyze: () => void;
  onStartManualClips: () => void;
  onRunDemoProject: () => void;
}

export function CreatePage({
  stagedMedia,
  config,
  appSettings,
  analyzing,
  analysisProgress,
  analysisStep,
  errorMsg,
  connectorStatus,
  urlStatusText,
  urlProgressPercent = 0,
  onSelectFile,
  onOpenRecorder,
  onImportUrl,
  onCancelImportUrl,
  onDownloadConnectorLauncher,
  onSaveStagedToPc,
  onUpdateConfig,
  onChangeAiEngine,
  onAnalyze,
  onStartManualClips,
  onRunDemoProject,
}: CreatePageProps) {
  const [dragging, setDragging] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isDesktopApp = Boolean(window.shortStudioDesktop?.isDesktop);

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || urlLoading) return;
    setUrlLoading(true);
    try {
      const ok = await onImportUrl(urlInput.trim());
      if (ok) setUrlInput('');
    } finally {
      setUrlLoading(false);
    }
  };

  return (
    <main className="flex-1 overflow-y-auto bg-[#0b0d12] p-6 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-7">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.06] pb-5">
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold tracking-tight text-white">
              Crear clips con IA local gratuita
            </h1>
            <p className="text-xs text-slate-400">
              Sube o graba tu video largo. El análisis acústico, la transcripción Whisper y la
              edición 1080p corren en tu navegador sin costo.
            </p>
          </div>
          <button
            type="button"
            disabled={analyzing}
            onClick={onRunDemoProject}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium text-slate-200 bg-[#161a23] border border-white/[0.07] hover:bg-[#1d222e] disabled:opacity-45 cursor-pointer whitespace-nowrap transition-colors"
          >
            <Play className="w-3.5 h-3.5 text-blue-400" />
            <span>Probar Proyecto Demo</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
          {/* Left Column: Media Import & Live Analysis */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onSelectFile(file);
                e.target.value = '';
              }}
            />

            {/* Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) onSelectFile(file);
              }}
              className={`rounded-2xl border border-dashed p-9 text-center transition-colors flex flex-col items-center gap-4 ${
                dragging
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-white/[0.12] bg-[#12151c] hover:border-white/[0.2] hover:bg-[#141821]'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                <Upload className="w-5 h-5 text-blue-400" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <p className="text-sm font-semibold text-white">
                  Arrastra tu video aquí o selecciónalo desde tu equipo
                </p>
                <p className="text-xs text-slate-400">
                  Compatible con MP4, MOV y WebM. El archivo se guarda localmente en IndexedDB.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={analyzing}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-45 cursor-pointer transition-colors"
                >
                  <FileVideo className="w-3.5 h-3.5" />
                  <span>Elegir Archivo</span>
                </button>
                <button
                  type="button"
                  disabled={analyzing}
                  onClick={onOpenRecorder}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#202633] disabled:opacity-45 cursor-pointer transition-colors"
                >
                  <Video className="w-3.5 h-3.5 text-rose-400" />
                  <span>Grabar Cámara / Pantalla</span>
                </button>
              </div>
            </div>

            {/* Direct / YouTube URL Import */}
            <form
              onSubmit={handleUrlSubmit}
              className="bg-[#12151c] border border-white/[0.06] rounded-2xl p-5 flex flex-col gap-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium text-slate-200">
                  Descargar desde YouTube, TikTok, Instagram, Vimeo o MP4 directo
                </label>
                {isDesktopApp ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Motor PC integrado</span>
                  </span>
                ) : connectorStatus.connected ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Conector PC activo</span>
                  </span>
                ) : (
                  <div className="flex items-center gap-3">
                    {isRunningInIframe() && typeof window !== 'undefined' && (
                      <a
                        href={window.location.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 whitespace-nowrap"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Abrir en pestaña directa</span>
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={analyzing || urlLoading}
                      onClick={onDownloadConnectorLauncher}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-blue-400 hover:text-blue-300 disabled:opacity-45 cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3 h-3" />
                      <span>Conector Windows (1 clic)</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-2.5">
                <div className="relative flex-1">
                  <Link2 className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="url"
                    value={urlInput}
                    disabled={analyzing || urlLoading}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://youtube.com/watch?v=... | https://tiktok.com/... | video.mp4"
                    className="w-full bg-[#0b0d12] border border-white/[0.06] rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!urlInput.trim() || analyzing || urlLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-medium text-slate-100 bg-[#181c25] hover:bg-[#202633] disabled:opacity-45 cursor-pointer whitespace-nowrap transition-colors"
                >
                  {urlLoading && <LoaderCircle className="w-3.5 h-3.5 animate-spin text-blue-400" />}
                  <span>
                    {urlLoading
                      ? `Descargando ${Math.max(0, Math.min(100, Math.round(urlProgressPercent)))}%`
                      : 'Descargar MP4'}
                  </span>
                </button>
              </div>

              {urlLoading ? (
                <div className="space-y-1.5 pt-0.5">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-300 truncate">
                      {urlStatusText || 'Descargando MP4...'}
                    </span>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="font-mono-tabular font-semibold text-blue-400">
                        {Math.max(0, Math.min(100, Math.round(urlProgressPercent)))}%
                      </span>
                      {onCancelImportUrl && (
                        <button
                          type="button"
                          onClick={onCancelImportUrl}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/25 text-rose-300 hover:bg-rose-500/20 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                          <span>Cancelar</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="h-1.5 bg-[#0b0d12] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-[width] duration-200"
                      style={{
                        width: `${Math.max(2, Math.min(100, Math.round(urlProgressPercent)))}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {isDesktopApp
                    ? 'Motor PC integrado: los enlaces se descargan en 1080p MP4, se guardan automáticamente en Descargas\\ShortStudio y entran directo al editor.'
                    : connectorStatus.connected
                    ? 'Conector Windows activo: los enlaces se descargan en 1080p MP4 directo a Descargas\\ShortStudio y entran al editor sin cookies.'
                    : 'Usa el Conector Windows (1 clic) para descargar enlaces de YouTube directamente a tu carpeta Descargas en MP4 sin cookies ni capturas.'}
                </p>
              )}
            </form>

            {/* Staged Media Card */}
            {stagedMedia && (
              <div className="bg-[#12151c] border border-white/[0.06] rounded-2xl p-5 flex flex-wrap items-center gap-4">
                <div className="w-24 h-16 rounded-xl bg-[#0b0d12] overflow-hidden shrink-0 flex items-center justify-center">
                  {stagedMedia.thumbnailDataUrl ? (
                    <img
                      src={stagedMedia.thumbnailDataUrl}
                      alt={stagedMedia.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <FileVideo className="w-6 h-6 text-slate-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold text-white truncate">
                    {stagedMedia.name}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono-tabular text-slate-400">
                    <span>
                      {stagedMedia.width}×{stagedMedia.height}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatTime(stagedMedia.duration)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{(stagedMedia.size / (1024 * 1024)).toFixed(1)} MB</span>
                  </div>
                  {stagedMedia.savedPcPath && (
                    <p className="text-[11px] text-emerald-400 truncate">
                      Guardado en PC · {stagedMedia.savedPcPath}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={analyzing}
                  onClick={onSaveStagedToPc}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#202633] disabled:opacity-45 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                >
                  <FolderDown className="w-3.5 h-3.5 text-blue-400" />
                  <span>Guardar MP4 en PC</span>
                </button>
              </div>
            )}

            {/* Analysis Progress */}
            {analyzing && (
              <div className="bg-[#12151c] border border-blue-500/30 rounded-2xl p-5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-2 font-medium text-white">
                    <LoaderCircle className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                    <span>{analysisStep}</span>
                  </span>
                  <span className="font-mono-tabular text-blue-400 font-semibold">
                    {analysisProgress}%
                  </span>
                </div>
                <div className="h-1.5 bg-[#0b0d12] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-[width] duration-200"
                    style={{ width: `${analysisProgress}%` }}
                  />
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="flex items-start gap-2.5 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-200">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Right Column: Configuration */}
          <div className="lg:col-span-5 bg-[#12151c] border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06]">
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-200">Motor de IA Local (Gratis)</h2>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                  <Cpu className="w-3 h-3" />
                  <span>0 USD</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 bg-[#0b0d12] p-1 rounded-xl">
                <button
                  type="button"
                  disabled={analyzing}
                  onClick={() => onChangeAiEngine('whisper-local')}
                  className={`py-2 px-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    appSettings.aiEngine === 'whisper-local'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  Whisper Local + Señales
                </button>
                <button
                  type="button"
                  disabled={analyzing}
                  onClick={() => onChangeAiEngine('acoustic-fast')}
                  className={`py-2 px-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    appSettings.aiEngine === 'acoustic-fast'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  Señales Acústicas (Rápido)
                </button>
              </div>
            </div>

            <div className="p-5 space-y-3">
              <h2 className="text-xs font-semibold text-slate-200">
                Perfiles Comerciales (1 clic)
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      label: 'Podcast / Entrevista',
                      ratio: '9:16' as TargetRatio,
                      framing: 'cover' as FitMode,
                      preset: 'hormozi' as SubtitlePresetId,
                      face: true,
                    },
                    {
                      label: 'Hook Viral Rápido',
                      ratio: '9:16' as TargetRatio,
                      framing: 'cover' as FitMode,
                      preset: 'mrbeast' as SubtitlePresetId,
                      face: true,
                    },
                    {
                      label: 'Tutorial / Pantalla',
                      ratio: '9:16' as TargetRatio,
                      framing: 'blur' as FitMode,
                      preset: 'capcut' as SubtitlePresetId,
                      face: false,
                    },
                    {
                      label: 'Marca Personal / Ads',
                      ratio: '1:1' as TargetRatio,
                      framing: 'cover' as FitMode,
                      preset: 'glass' as SubtitlePresetId,
                      face: true,
                    },
                  ]
                ).map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    disabled={analyzing}
                    onClick={() => {
                      onUpdateConfig('ratio', tpl.ratio);
                      onUpdateConfig('framing', tpl.framing);
                      onUpdateConfig('subtitlePreset', tpl.preset);
                      onUpdateConfig('autoFaceTrack', tpl.face);
                    }}
                    className="py-2 px-3 rounded-xl text-left text-[11px] font-medium bg-[#0b0d12]/80 text-slate-300 hover:bg-[#191f2c] hover:text-white transition-colors cursor-pointer truncate"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-5 space-y-3.5">
              <h2 className="text-xs font-semibold text-slate-200">Formato y Encuadre</h2>
              <div className="grid grid-cols-3 gap-1 bg-[#0b0d12] p-1 rounded-xl">
                {(
                  [
                    { id: '9:16', label: '9:16 Short' },
                    { id: '1:1', label: '1:1 Feed' },
                    { id: '16:9', label: '16:9 Horiz.' },
                  ] as Array<{ id: TargetRatio; label: string }>
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={analyzing}
                    onClick={() => onUpdateConfig('ratio', item.id)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      config.ratio === item.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-1 bg-[#0b0d12] p-1 rounded-xl">
                {(
                  [
                    { id: 'cover', label: 'Llenar' },
                    { id: 'blur', label: 'Fondo Blur' },
                    { id: 'fit', label: 'Cine' },
                  ] as Array<{ id: FitMode; label: string }>
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    disabled={analyzing}
                    onClick={() => onUpdateConfig('framing', f.id)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      config.framing === f.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-5 space-y-3.5">
              <h2 className="text-xs font-semibold text-slate-200">Clips y Subtítulos</h2>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-slate-400">Duración objetivo</span>
                  <select
                    value={config.targetDuration}
                    disabled={analyzing}
                    onChange={(e) =>
                      onUpdateConfig('targetDuration', e.target.value as TargetDuration)
                    }
                    className="bg-[#0b0d12] border border-white/[0.06] rounded-xl px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                  >
                    <option value="auto">Automático</option>
                    <option value="<30s">Menos de 30s</option>
                    <option value="30-60s">30s a 60s</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-slate-400">Idioma del audio</span>
                  <select
                    value={config.language}
                    disabled={analyzing}
                    onChange={(e) => onUpdateConfig('language', e.target.value)}
                    className="bg-[#0b0d12] border border-white/[0.06] rounded-xl px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                  >
                    <option value="es">Español</option>
                    <option value="en">Inglés</option>
                    <option value="pt">Portugués</option>
                    <option value="auto">Detectar automático</option>
                  </select>
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-slate-400">Plantilla inicial de subtítulos</span>
                <select
                  value={config.subtitlePreset}
                  disabled={analyzing}
                  onChange={(e) =>
                    onUpdateConfig('subtitlePreset', e.target.value as SubtitlePresetId)
                  }
                  className="bg-[#0b0d12] border border-white/[0.06] rounded-xl px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                >
                  <option value="hormozi">Hormozi (Karaoke Amarillo)</option>
                  <option value="mrbeast">MrBeast (Rebote Alto Impacto)</option>
                  <option value="capcut">CapCut (Revelado + Píldora)</option>
                  <option value="tiktok">TikTok (Caja Blanca Clásica)</option>
                  <option value="glass">Cristal (Tarjeta Translúcida)</option>
                  <option value="minimal">Minimal (Limpio)</option>
                </select>
              </label>

              <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer pt-1">
                <span>Incluir barra de retención</span>
                <input
                  type="checkbox"
                  checked={config.generateProgressBar}
                  disabled={analyzing}
                  onChange={(e) => onUpdateConfig('generateProgressBar', e.target.checked)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                <span>Seguimiento automático de rostro</span>
                <input
                  type="checkbox"
                  checked={config.autoFaceTrack}
                  disabled={analyzing}
                  onChange={(e) => onUpdateConfig('autoFaceTrack', e.target.checked)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
              </label>
            </div>

            <div className="p-5 space-y-2.5">
              <button
                type="button"
                disabled={!stagedMedia || analyzing}
                onClick={onAnalyze}
                className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <span>
                  {analyzing ? 'Analizando video localmente...' : 'Analizar y Generar Clips'}
                </span>
                {!analyzing && <ArrowRight className="w-4 h-4" />}
              </button>
              <button
                type="button"
                disabled={!stagedMedia || analyzing}
                onClick={onStartManualClips}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#202633] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <Scissors className="w-3.5 h-3.5 text-blue-400" />
                <span>Crear Clips Manualmente</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
