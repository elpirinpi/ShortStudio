import { LoaderCircle, RotateCcw, ScanFace, Scissors, Sparkles, Trash2 } from 'lucide-react';
import {
  EditorSettings,
  FitMode,
  HookStyle,
  LeftTab,
  ProgressPos,
  SubBgMode,
  SubMode,
  TargetRatio,
  TransitionInType,
  WatermarkPos,
} from '../types/editor';
import { getEffectiveSourceDuration } from '../utils/clipTiming';

interface LeftSidebarProps {
  activeTab: LeftTab;
  onTabChange: (tab: LeftTab) => void;
  settings: EditorSettings;
  duration: number;
  hasMediaOrDemo: boolean;
  hasBgm: boolean;
  bgmName: string;
  trackingFaces: boolean;
  faceTrackProgress: number;
  faceTrackStatus: string;
  analyzingAudio?: boolean;
  onUpdateSetting: <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => void;
  onApplySubtitlePreset: (patch: Partial<EditorSettings>) => void;
  onTrimStartChange: (val: number) => void;
  onTrimEndChange: (val: number) => void;
  onDetectSilences?: () => void;
  onResetFraming: () => void;
  onResetColor: () => void;
  onRemoveBgm: () => void;
  onRunFaceTracking: () => void;
  onClearFaceTracking: () => void;
}

export function LeftSidebar({
  activeTab,
  onTabChange,
  settings,
  duration,
  hasMediaOrDemo,
  hasBgm,
  bgmName,
  trackingFaces,
  faceTrackProgress,
  faceTrackStatus,
  analyzingAudio = false,
  onUpdateSetting,
  onApplySubtitlePreset,
  onTrimStartChange,
  onTrimEndChange,
  onDetectSilences,
  onResetFraming,
  onResetColor,
  onRemoveBgm,
  onRunFaceTracking,
  onClearFaceTracking,
}: LeftSidebarProps) {
  const applySubPreset = (
    preset: 'hormozi' | 'mrbeast' | 'capcut' | 'tiktok' | 'glass' | 'minimal'
  ) => {
    if (preset === 'hormozi') {
      onApplySubtitlePreset({
        subMode: 'karaoke',
        subBgMode: 'none',
        subPop: true,
        subUpper: true,
        subFont: "'Montserrat', Impact, sans-serif",
        subSize: 68,
        subStroke: 13,
        subShadow: 18,
        subMaxWidth: 860,
        subColor: '#ffffff',
        subHighlight: '#facc15',
        subStrokeColor: '#000000',
      });
    } else if (preset === 'mrbeast') {
      onApplySubtitlePreset({
        subMode: 'bounce',
        subBgMode: 'none',
        subPop: true,
        subUpper: true,
        subFont: "'Anton', Impact, sans-serif",
        subSize: 78,
        subStroke: 16,
        subShadow: 22,
        subMaxWidth: 840,
        subColor: '#ffffff',
        subHighlight: '#22d3ee',
        subStrokeColor: '#000000',
      });
    } else if (preset === 'capcut') {
      onApplySubtitlePreset({
        subMode: 'reveal',
        subBgMode: 'word-pill',
        subPop: true,
        subUpper: true,
        subFont: "'Montserrat', Impact, sans-serif",
        subSize: 64,
        subStroke: 10,
        subShadow: 14,
        subMaxWidth: 840,
        subColor: '#ffffff',
        subHighlight: '#f43f5e',
        subStrokeColor: '#000000',
      });
    } else if (preset === 'tiktok') {
      onApplySubtitlePreset({
        subMode: 'classic',
        subBgMode: 'line-box',
        subPop: false,
        subUpper: false,
        subFont: "'Poppins', sans-serif",
        subSize: 50,
        subStroke: 0,
        subShadow: 0,
        subMaxWidth: 820,
        subColor: '#0f172a',
        subHighlight: '#e11d48',
        subBgColor: '#ffffff',
      });
    } else if (preset === 'glass') {
      onApplySubtitlePreset({
        subMode: 'karaoke',
        subBgMode: 'glass-card',
        subPop: true,
        subUpper: false,
        subFont: "'Plus Jakarta Sans', sans-serif",
        subSize: 52,
        subStroke: 0,
        subShadow: 6,
        subMaxWidth: 860,
        subColor: '#f8fafc',
        subHighlight: '#38bdf8',
        subBgColor: '#0f172a',
      });
    } else {
      onApplySubtitlePreset({
        subMode: 'classic',
        subBgMode: 'none',
        subPop: false,
        subUpper: false,
        subFont: "'Poppins', sans-serif",
        subSize: 48,
        subStroke: 6,
        subShadow: 12,
        subMaxWidth: 880,
        subColor: '#f8fafc',
        subHighlight: '#facc15',
        subStrokeColor: '#0f172a',
      });
    }
  };

  const applyColorPreset = (preset: 'original' | 'cine' | 'vibrant' | 'bw') => {
    if (preset === 'original') {
      onResetColor();
    } else if (preset === 'cine') {
      onUpdateSetting('bright', 96);
      onUpdateSetting('contrast', 118);
      onUpdateSetting('sat', 90);
    } else if (preset === 'vibrant') {
      onUpdateSetting('bright', 105);
      onUpdateSetting('contrast', 112);
      onUpdateSetting('sat', 135);
    } else {
      onUpdateSetting('bright', 102);
      onUpdateSetting('contrast', 128);
      onUpdateSetting('sat', 0);
    }
  };

  return (
    <aside className="w-[316px] shrink-0 bg-[#12151c] border-r border-white/[0.06] flex flex-col min-h-0">
      <div className="flex border-b border-white/[0.06] bg-[#0e1118]">
        {(
          [
            { id: 'format', label: 'Encuadre' },
            { id: 'subs', label: 'Subtítulos' },
            { id: 'color', label: 'Color & Audio' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 py-3 px-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === tab.id
                ? 'text-white border-blue-500 bg-[#12151c]'
                : 'text-slate-400 border-transparent hover:text-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06]">
        {activeTab === 'format' && (
          <>
            <section className="p-4 flex flex-col gap-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-200">Formato y Encuadre</h2>
                <button
                  type="button"
                  onClick={onResetFraming}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-100 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Restablecer</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1 bg-[#0b0d12] p-1 rounded-xl">
                {(
                  [
                    { id: '9:16', label: '9:16 Short' },
                    { id: '1:1', label: '1:1 Cuadrado' },
                    { id: '16:9', label: '16:9 Horiz.' },
                  ] as Array<{ id: TargetRatio; label: string }>
                ).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onUpdateSetting('ratio', r.id)}
                    className={`py-1.5 px-1.5 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      settings.ratio === r.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {r.label}
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
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => onUpdateSetting('fitMode', mode.id)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      settings.fitMode === mode.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Zoom</span>
                  <span className="font-mono-tabular text-blue-400">{settings.zoom}%</span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={300}
                  value={settings.zoom}
                  onChange={(e) => onUpdateSetting('zoom', Number(e.target.value))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Posición X</span>
                  <span className="font-mono-tabular text-blue-400">{settings.panX}%</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={settings.panX}
                  onChange={(e) => onUpdateSetting('panX', Number(e.target.value))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Posición Y</span>
                  <span className="font-mono-tabular text-blue-400">{settings.panY}%</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={settings.panY}
                  onChange={(e) => onUpdateSetting('panY', Number(e.target.value))}
                />
              </div>

              <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer pt-1">
                <span>Esquinas redondeadas (Blur)</span>
                <input
                  type="checkbox"
                  checked={settings.rounded}
                  onChange={(e) => onUpdateSetting('rounded', e.target.checked)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
              </label>
            </section>

            <section className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-200">Seguimiento de Rostro (IA)</h2>
                {settings.faceKeyframes.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearFaceTracking}
                    className="text-[11px] text-slate-400 hover:text-rose-300 cursor-pointer"
                  >
                    Limpiar
                  </button>
                )}
              </div>

              <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                <span>Centrar rostro automáticamente</span>
                <input
                  type="checkbox"
                  checked={settings.faceTracking}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    onUpdateSetting('faceTracking', checked);
                    if (checked && settings.faceKeyframes.length === 0 && hasMediaOrDemo && !trackingFaces) {
                      onRunFaceTracking();
                    }
                  }}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
              </label>

              <button
                type="button"
                disabled={!hasMediaOrDemo || trackingFaces}
                onClick={onRunFaceTracking}
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {trackingFaces ? (
                  <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ScanFace className="w-3.5 h-3.5" />
                )}
                <span>
                  {trackingFaces
                    ? `Rastreando ${faceTrackProgress}%`
                    : settings.faceKeyframes.length > 0
                    ? 'Re-analizar Rostro en Clip'
                    : 'Detectar y Seguir Rostro'}
                </span>
              </button>

              {trackingFaces && (
                <div className="space-y-1.5">
                  <div className="h-1.5 bg-[#0b0d12] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-[width] duration-150"
                      style={{ width: `${faceTrackProgress}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">{faceTrackStatus}</p>
                </div>
              )}

              {settings.faceKeyframes.length > 0 && !trackingFaces && (
                <p className="text-[11px] font-mono-tabular text-slate-400">
                  {settings.faceKeyframes.length} puntos clave ·{' '}
                  {settings.faceEngineUsed || 'Detector local'}
                </p>
              )}

              <div className="flex flex-col gap-1.5 pt-0.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Suavizado de cámara</span>
                  <span className="font-mono-tabular text-blue-400">
                    {settings.faceSmoothing}%
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={95}
                  value={settings.faceSmoothing}
                  onChange={(e) => onUpdateSetting('faceSmoothing', Number(e.target.value))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Altura del rostro</span>
                  <span className="font-mono-tabular text-blue-400">
                    {settings.faceHeadroom}%
                  </span>
                </div>
                <input
                  type="range"
                  min={22}
                  max={56}
                  value={settings.faceHeadroom}
                  onChange={(e) => onUpdateSetting('faceHeadroom', Number(e.target.value))}
                />
              </div>
            </section>

            <section className="p-4 flex flex-col gap-3.5">
              <h2 className="text-xs font-semibold text-slate-200">Recorte y Velocidad</h2>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-400">Inicio (seg)</span>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, settings.trimEnd - 0.3)}
                    step={0.1}
                    value={Number(settings.trimStart.toFixed(1))}
                    onChange={(e) => onTrimStartChange(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#0b0d12] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-blue-500/70"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-400">Fin (seg)</span>
                  <input
                    type="number"
                    min={settings.trimStart + 0.3}
                    max={duration}
                    step={0.1}
                    value={Number(settings.trimEnd.toFixed(1))}
                    onChange={(e) => onTrimEndChange(parseFloat(e.target.value) || duration)}
                    className="w-full bg-[#0b0d12] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-blue-500/70"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Velocidad</span>
                  <span className="font-mono-tabular text-blue-400">
                    {settings.speed.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.05}
                  value={settings.speed}
                  onChange={(e) => onUpdateSetting('speed', parseFloat(e.target.value))}
                />
              </div>
            </section>

            <section className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-200">
                  Corte Automático de Silencios
                </h2>
                <input
                  type="checkbox"
                  checked={Boolean(settings.silenceCutEnabled)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    onUpdateSetting('silenceCutEnabled', checked);
                    if (
                      checked &&
                      (!settings.speechSegments || settings.speechSegments.length === 0) &&
                      hasMediaOrDemo
                    ) {
                      onDetectSilences?.();
                    }
                  }}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                  aria-label="Activar corte automático de silencios"
                />
              </div>

              {onDetectSilences && (
                <button
                  type="button"
                  disabled={!hasMediaOrDemo || analyzingAudio}
                  onClick={onDetectSilences}
                  className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-medium text-slate-100 bg-[#181c25] hover:bg-[#202633] disabled:opacity-45 cursor-pointer transition-colors"
                >
                  {analyzingAudio ? (
                    <LoaderCircle className="w-3.5 h-3.5 animate-spin text-blue-400" />
                  ) : (
                    <Scissors className="w-3.5 h-3.5 text-blue-400" />
                  )}
                  <span>
                    {analyzingAudio
                      ? 'Analizando pausas...'
                      : settings.speechSegments && settings.speechSegments.length > 0
                      ? 'Recalcular Pausas de Silencio'
                      : 'Detectar Silencios en Audio'}
                  </span>
                </button>
              )}

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Sensibilidad</span>
                  <span className="font-mono-tabular text-blue-400">
                    {settings.silenceThresholdDb ?? -34} dB
                  </span>
                </div>
                <input
                  type="range"
                  min={-45}
                  max={-22}
                  step={1}
                  value={settings.silenceThresholdDb ?? -34}
                  onChange={(e) =>
                    onUpdateSetting('silenceThresholdDb', Number(e.target.value))
                  }
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Pausa mínima</span>
                  <span className="font-mono-tabular text-blue-400">
                    {(settings.silenceMinSec ?? 0.45).toFixed(2)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={0.25}
                  max={1.2}
                  step={0.05}
                  value={settings.silenceMinSec ?? 0.45}
                  onChange={(e) => onUpdateSetting('silenceMinSec', Number(e.target.value))}
                />
              </div>

              {settings.silenceCutEnabled &&
                settings.speechSegments &&
                settings.speechSegments.length > 0 && (
                  <p className="text-[11px] font-mono-tabular text-emerald-400">
                    {settings.speechSegments.length} bloques de voz · -
                    {Math.max(
                      0,
                      settings.trimEnd -
                        settings.trimStart -
                        getEffectiveSourceDuration(settings)
                    ).toFixed(1)}
                    s silencios recortados
                  </p>
                )}
            </section>

            <section className="p-4 flex flex-col gap-3">
              <h2 className="text-xs font-semibold text-slate-200">Barra de Retención</h2>
              <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                <span>Mostrar barra de progreso</span>
                <input
                  type="checkbox"
                  checked={settings.progressBar}
                  onChange={(e) => onUpdateSetting('progressBar', e.target.checked)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={settings.progressPos}
                  onChange={(e) => onUpdateSetting('progressPos', e.target.value as ProgressPos)}
                  className="bg-[#0b0d12] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                >
                  <option value="top">Arriba</option>
                  <option value="bottom">Abajo</option>
                </select>
                <input
                  type="color"
                  value={settings.progressColor}
                  onChange={(e) => onUpdateSetting('progressColor', e.target.value)}
                  className="w-full h-8 bg-[#0b0d12] border border-white/[0.06] rounded-lg p-0.5 cursor-pointer"
                />
              </div>
            </section>
          </>
        )}

        {activeTab === 'subs' && (
          <>
            <section className="p-4 flex flex-col gap-3">
              <h2 className="text-xs font-semibold text-slate-200">Plantillas Virales</h2>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'hormozi', label: 'Hormozi' },
                    { id: 'mrbeast', label: 'MrBeast' },
                    { id: 'capcut', label: 'CapCut' },
                    { id: 'tiktok', label: 'TikTok' },
                    { id: 'glass', label: 'Cristal' },
                    { id: 'minimal', label: 'Minimal' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applySubPreset(preset.id)}
                    className="py-1.5 px-2 rounded-lg text-xs font-medium bg-[#181c25] text-slate-200 hover:bg-[#222836] hover:text-white cursor-pointer whitespace-nowrap transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                  <span>Gancho Superior y Transición</span>
                </h2>
                <input
                  type="checkbox"
                  checked={Boolean(settings.hookEnabled)}
                  onChange={(e) => onUpdateSetting('hookEnabled', e.target.checked)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                  aria-label="Activar título gancho superior"
                />
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Transición de entrada</span>
                <select
                  value={settings.transitionIn || 'none'}
                  onChange={(e) =>
                    onUpdateSetting('transitionIn', e.target.value as TransitionInType)
                  }
                  className="bg-[#0b0d12] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                >
                  <option value="none">Sin transición</option>
                  <option value="zoom-punch">Zoom Punch (TikTok)</option>
                  <option value="slide-up">Deslizar hacia arriba</option>
                  <option value="fade">Fundido suave</option>
                </select>
              </label>

              {settings.hookEnabled && (
                <div className="flex flex-col gap-2.5 pt-2 border-t border-white/[0.06]">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-400">Texto del gancho superior</span>
                    <input
                      type="text"
                      value={settings.hookText || ''}
                      onChange={(e) => onUpdateSetting('hookText', e.target.value)}
                      placeholder="Ej: El secreto que nadie te cuenta"
                      className="w-full bg-[#0b0d12] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-1 bg-[#0b0d12] p-1 rounded-xl">
                    {(
                      [
                        { id: 'white-box', label: 'Caja Blanca', bg: '#ffffff', txt: '#0f172a' },
                        { id: 'dark-neon', label: 'Oscuro Neón', bg: '#0f172a', txt: '#ffffff' },
                        { id: 'red-hook', label: 'Alerta Roja', bg: '#e11d48', txt: '#ffffff' },
                        { id: 'minimal-clean', label: 'Texto Limpio', bg: '#000000', txt: '#ffffff' },
                      ] as Array<{ id: HookStyle; label: string; bg: string; txt: string }>
                    ).map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() =>
                          onApplySubtitlePreset({
                            hookStyle: st.id,
                            hookBgColor: st.bg,
                            hookTextColor: st.txt,
                          })
                        }
                        className={`py-1.5 px-2 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                          (settings.hookStyle || 'white-box') === st.id
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-slate-100'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-400">Duración</span>
                      <select
                        value={settings.hookDurationSec ?? 3.5}
                        onChange={(e) =>
                          onUpdateSetting('hookDurationSec', Number(e.target.value))
                        }
                        className="bg-[#0b0d12] border border-white/[0.06] rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                      >
                        <option value={3.5}>Primeros 3.5s</option>
                        <option value={5}>Primeros 5s</option>
                        <option value={0}>Todo el clip</option>
                      </select>
                    </label>
                    <div className="flex flex-col gap-1 justify-center">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400">Altura</span>
                        <span className="font-mono-tabular text-blue-400">
                          {settings.hookY ?? 14}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={8}
                        max={36}
                        value={settings.hookY ?? 14}
                        onChange={(e) => onUpdateSetting('hookY', Number(e.target.value))}
                      />
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="p-4 flex flex-col gap-3">
              <h2 className="text-xs font-semibold text-slate-200">Animación y Fondo</h2>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] text-slate-400">Modo de palabra</span>
                <select
                  value={settings.subMode}
                  onChange={(e) => onUpdateSetting('subMode', e.target.value as SubMode)}
                  className="bg-[#0b0d12] border border-white/[0.06] rounded-lg px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                >
                  <option value="karaoke">Karaoke (Resalte suave)</option>
                  <option value="bounce">Rebote Elástico (Salto activo)</option>
                  <option value="reveal">Revelado Progresivo (Palabra a palabra)</option>
                  <option value="classic">Bloque Estático (Usa *palabra*)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] text-slate-400">Estilo de fondo</span>
                <div className="grid grid-cols-2 gap-1 bg-[#0b0d12] p-1 rounded-xl">
                  {(
                    [
                      { id: 'none', label: 'Sin fondo' },
                      { id: 'word-pill', label: 'Píldora activa' },
                      { id: 'line-box', label: 'Caja sólida' },
                      { id: 'glass-card', label: 'Tarjeta cristal' },
                    ] as Array<{ id: SubBgMode; label: string }>
                  ).map((bg) => (
                    <button
                      key={bg.id}
                      type="button"
                      onClick={() => onUpdateSetting('subBgMode', bg.id)}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        settings.subBgMode === bg.id
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-slate-100'
                      }`}
                    >
                      {bg.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer pt-0.5">
                <span>Entrada Pop-In del bloque</span>
                <input
                  type="checkbox"
                  checked={settings.subPop}
                  onChange={(e) => onUpdateSetting('subPop', e.target.checked)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                <span>Todo en mayúsculas</span>
                <input
                  type="checkbox"
                  checked={settings.subUpper}
                  onChange={(e) => onUpdateSetting('subUpper', e.target.checked)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
              </label>
            </section>

            <section className="p-4 flex flex-col gap-3.5">
              <h2 className="text-xs font-semibold text-slate-200">Tipografía y Posición</h2>
              <select
                value={settings.subFont}
                onChange={(e) => onUpdateSetting('subFont', e.target.value)}
                className="bg-[#0b0d12] border border-white/[0.06] rounded-lg px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
              >
                <option value="'Montserrat', Impact, sans-serif">Montserrat Black</option>
                <option value="'Anton', Impact, sans-serif">Anton Impact</option>
                <option value="'Poppins', sans-serif">Poppins ExtraBold</option>
                <option value="'Oswald', Impact, sans-serif">Oswald Condensed</option>
                <option value="'Plus Jakarta Sans', sans-serif">Plus Jakarta Sans</option>
              </select>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Tamaño</span>
                  <span className="font-mono-tabular text-blue-400">{settings.subSize}px</span>
                </div>
                <input
                  type="range"
                  min={32}
                  max={110}
                  value={settings.subSize}
                  onChange={(e) => onUpdateSetting('subSize', Number(e.target.value))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">Altura Vertical</span>
                  <div className="flex items-center gap-1">
                    {[
                      { label: 'Arriba', val: 24 },
                      { label: 'Centro', val: 50 },
                      { label: 'Abajo', val: 70 },
                    ].map((pos) => (
                      <button
                        key={pos.label}
                        type="button"
                        onClick={() => onUpdateSetting('subY', pos.val)}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-[#181c25] text-slate-300 hover:bg-[#222836] hover:text-white cursor-pointer"
                      >
                        {pos.label}
                      </button>
                    ))}
                    <span className="font-mono-tabular text-blue-400 ml-1">
                      {settings.subY}%
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min={15}
                  max={86}
                  value={settings.subY}
                  onChange={(e) => onUpdateSetting('subY', Number(e.target.value))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Ancho Máximo</span>
                  <span className="font-mono-tabular text-blue-400">
                    {settings.subMaxWidth}px
                  </span>
                </div>
                <input
                  type="range"
                  min={560}
                  max={960}
                  step={20}
                  value={settings.subMaxWidth}
                  onChange={(e) => onUpdateSetting('subMaxWidth', Number(e.target.value))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-300">Contorno</span>
                    <span className="font-mono-tabular text-blue-400">{settings.subStroke}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    value={settings.subStroke}
                    onChange={(e) => onUpdateSetting('subStroke', Number(e.target.value))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-300">Sombra</span>
                    <span className="font-mono-tabular text-blue-400">{settings.subShadow}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={36}
                    value={settings.subShadow}
                    onChange={(e) => onUpdateSetting('subShadow', Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400">Texto</span>
                  <input
                    type="color"
                    value={settings.subColor}
                    onChange={(e) => onUpdateSetting('subColor', e.target.value)}
                    className="w-full h-8 bg-[#0b0d12] border border-white/[0.06] rounded-lg p-0.5 cursor-pointer"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400">Énfasis</span>
                  <input
                    type="color"
                    value={settings.subHighlight}
                    onChange={(e) => onUpdateSetting('subHighlight', e.target.value)}
                    className="w-full h-8 bg-[#0b0d12] border border-white/[0.06] rounded-lg p-0.5 cursor-pointer"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400">Borde</span>
                  <input
                    type="color"
                    value={settings.subStrokeColor}
                    onChange={(e) => onUpdateSetting('subStrokeColor', e.target.value)}
                    className="w-full h-8 bg-[#0b0d12] border border-white/[0.06] rounded-lg p-0.5 cursor-pointer"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400">Fondo</span>
                  <input
                    type="color"
                    value={settings.subBgColor}
                    onChange={(e) => onUpdateSetting('subBgColor', e.target.value)}
                    className="w-full h-8 bg-[#0b0d12] border border-white/[0.06] rounded-lg p-0.5 cursor-pointer"
                  />
                </label>
              </div>
            </section>
          </>
        )}

        {activeTab === 'color' && (
          <>
            <section className="p-4 flex flex-col gap-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-200">Corrección de Color</h2>
                <button
                  type="button"
                  onClick={onResetColor}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-100 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    { id: 'original', label: 'Base' },
                    { id: 'cine', label: 'Cine' },
                    { id: 'vibrant', label: 'Vivo' },
                    { id: 'bw', label: 'B&N' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyColorPreset(preset.id)}
                    className="py-1.5 px-1 rounded-lg text-[11px] font-medium bg-[#181c25] text-slate-200 hover:bg-[#222836] cursor-pointer transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Brillo</span>
                  <span className="font-mono-tabular text-blue-400">{settings.bright}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={160}
                  value={settings.bright}
                  onChange={(e) => onUpdateSetting('bright', Number(e.target.value))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Contraste</span>
                  <span className="font-mono-tabular text-blue-400">{settings.contrast}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={160}
                  value={settings.contrast}
                  onChange={(e) => onUpdateSetting('contrast', Number(e.target.value))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Saturación</span>
                  <span className="font-mono-tabular text-blue-400">{settings.sat}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={settings.sat}
                  onChange={(e) => onUpdateSetting('sat', Number(e.target.value))}
                />
              </div>
            </section>

            <section className="p-4 flex flex-col gap-3.5">
              <h2 className="text-xs font-semibold text-slate-200">Mezcla de Audio</h2>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Audio del Video</span>
                  <span className="font-mono-tabular text-blue-400">{settings.volVideo}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={150}
                  value={settings.volVideo}
                  onChange={(e) => onUpdateSetting('volVideo', Number(e.target.value))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Música de Fondo</span>
                  <span className="font-mono-tabular text-blue-400">{settings.volBgm}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={150}
                  value={settings.volBgm}
                  onChange={(e) => onUpdateSetting('volBgm', Number(e.target.value))}
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-slate-400 truncate">
                  {hasBgm ? bgmName : 'Sin música cargada'}
                </span>
                {hasBgm && (
                  <button
                    type="button"
                    onClick={onRemoveBgm}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-rose-300 bg-rose-500/12 hover:bg-rose-500/22 shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Quitar</span>
                  </button>
                )}
              </div>
            </section>

            <section className="p-4 flex flex-col gap-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-200">Marca de Agua / Brand Kit</h2>
                <input
                  type="checkbox"
                  checked={Boolean(settings.watermarkEnabled)}
                  onChange={(e) => onUpdateSetting('watermarkEnabled', e.target.checked)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                  aria-label="Activar marca de agua"
                />
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Texto o @usuario de marca</span>
                <input
                  type="text"
                  value={settings.watermarkText ?? '@tu_canal'}
                  onChange={(e) => onUpdateSetting('watermarkText', e.target.value)}
                  placeholder="@tu_marca"
                  className="w-full bg-[#0b0d12] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                />
              </label>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-400">Posición</span>
                  <select
                    value={settings.watermarkPos || 'top-right'}
                    onChange={(e) =>
                      onUpdateSetting('watermarkPos', e.target.value as WatermarkPos)
                    }
                    className="bg-[#0b0d12] border border-white/[0.06] rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                  >
                    <option value="top-left">Superior Izquierda</option>
                    <option value="top-right">Superior Derecha</option>
                    <option value="bottom-left">Inferior Izquierda</option>
                    <option value="bottom-right">Inferior Derecha</option>
                  </select>
                </label>

                <div className="flex flex-col gap-1.5 justify-center">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Opacidad</span>
                    <span className="font-mono-tabular text-blue-400">
                      {settings.watermarkOpacity ?? 75}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    value={settings.watermarkOpacity ?? 75}
                    onChange={(e) => onUpdateSetting('watermarkOpacity', Number(e.target.value))}
                  />
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
