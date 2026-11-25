import { useEffect, useState } from 'react';
import { Code2, HardDrive, LogOut, Trash2, User } from 'lucide-react';
import {
  AiEngineMode,
  AppSettings,
  FitMode,
  SubtitlePresetId,
  TargetRatio,
  WhisperModelId,
} from '../types/editor';
import { getStorageEstimate } from '../utils/db';

interface SettingsPageProps {
  settings: AppSettings;
  projectsCount: number;
  userEmail?: string | null;
  onSignOut?: () => void;
  onUpdateSettings: (next: AppSettings) => void;
  onClearAllData: () => Promise<void>;
}

export function SettingsPage({
  settings,
  projectsCount,
  userEmail,
  onSignOut,
  onUpdateSettings,
  onClearAllData,
}: SettingsPageProps) {
  const [storage, setStorage] = useState<{ usedMB: number; quotaMB: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    getStorageEstimate().then(setStorage);
  }, [projectsCount]);

  const update = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => {
    onUpdateSettings({ ...settings, [key]: val });
  };

  return (
    <main className="flex-1 overflow-y-auto bg-[#0b0d11] p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="border-b border-slate-800/80 pb-4 space-y-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            Ajustes de IA Local y Estudio
          </h1>
          <p className="text-xs text-slate-400">
            Configura el motor gratuito de transcripción local en el navegador y tus valores
            predeterminados de ShortStudio.
          </p>
        </div>

        <section className="bg-[#12151c] border border-slate-800/90 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-100">Motor de IA Local (0 USD)</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-300">Modo de análisis</span>
              <select
                value={settings.aiEngine}
                onChange={(e) => update('aiEngine', e.target.value as AiEngineMode)}
                className="bg-[#0b0d11] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="whisper-local">Whisper Local + Señales (Gratis)</option>
                <option value="acoustic-fast">Solo Señales Acústicas (Instantáneo)</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-300">Modelo Whisper en navegador</span>
              <select
                value={settings.whisperModel}
                onChange={(e) => update('whisperModel', e.target.value as WhisperModelId)}
                className="bg-[#0b0d11] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="Xenova/whisper-tiny">Whisper Tiny (~40 MB · Rápido)</option>
                <option value="Xenova/whisper-base">Whisper Base (~75 MB · Mayor precisión)</option>
              </select>
            </label>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            El modelo se descarga una sola vez directamente en la caché de tu navegador y ejecuta
            la transcripción palabra por palabra localmente sin enviar tus videos ni cobrar créditos.
          </p>
        </section>

        <section className="bg-[#12151c] border border-slate-800/90 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-100">
            Valores Predeterminados de Nuevos Proyectos
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-300">Idioma de audio</span>
              <select
                value={settings.defaultLanguage}
                onChange={(e) => update('defaultLanguage', e.target.value)}
                className="bg-[#0b0d11] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="es">Español</option>
                <option value="en">Inglés</option>
                <option value="pt">Portugués</option>
                <option value="auto">Detectar automático</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-300">Relación de aspecto</span>
              <select
                value={settings.defaultRatio}
                onChange={(e) => update('defaultRatio', e.target.value as TargetRatio)}
                className="bg-[#0b0d11] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="9:16">9:16 Vertical (Shorts / TikTok)</option>
                <option value="1:1">1:1 Cuadrado</option>
                <option value="16:9">16:9 Horizontal</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-300">Encuadre por defecto</span>
              <select
                value={settings.defaultFraming}
                onChange={(e) => update('defaultFraming', e.target.value as FitMode)}
                className="bg-[#0b0d11] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="cover">Llenar (Crop)</option>
                <option value="blur">Fondo Desenfocado</option>
                <option value="fit">Cine</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-300">Plantilla de subtítulos</span>
              <select
                value={settings.defaultPreset}
                onChange={(e) => update('defaultPreset', e.target.value as SubtitlePresetId)}
                className="bg-[#0b0d11] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="hormozi">Hormozi</option>
                <option value="mrbeast">MrBeast</option>
                <option value="capcut">CapCut</option>
                <option value="tiktok">TikTok</option>
                <option value="glass">Cristal</option>
                <option value="minimal">Minimal</option>
              </select>
            </label>
          </div>
        </section>

        <section className="bg-[#12151c] border border-slate-800/90 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <HardDrive className="w-5 h-5 text-slate-400 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-100">Almacenamiento Local (IndexedDB)</h2>
              <p className="text-xs font-mono-tabular text-slate-400">
                {projectsCount} proyectos guardados
                {storage ? ` · ${storage.usedMB} MB usados de ${storage.quotaMB} MB disponibles` : ''}
              </p>
            </div>
          </div>

          {!confirmClear ? (
            <button
              type="button"
              disabled={projectsCount === 0}
              onClick={() => setConfirmClear(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-rose-300 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 disabled:opacity-40 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Limpiar Proyectos</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-300 bg-[#191d26] border border-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onClearAllData();
                  setConfirmClear(false);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer"
              >
                Confirmar borrado
              </button>
            </div>
          )}
        </section>

        <section className="bg-[#12151c] border border-slate-800/90 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <User className="w-5 h-5 text-indigo-400 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-100">Cuenta de Supabase</h2>
              <p className="text-xs text-slate-400">
                {userEmail
                  ? `Sesión iniciada como ${userEmail}`
                  : 'Sesión de Supabase activa'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-200 bg-[#191d26] border border-slate-800 hover:bg-[#222733] cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Cerrar Sesión</span>
          </button>
        </section>

        <section className="bg-[#12151c] border border-slate-800/90 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Code2 className="w-5 h-5 text-emerald-400 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-100">Créditos del Desarrollador</h2>
              <p className="text-xs text-slate-300">
                Desarrollado por{' '}
                <span className="font-semibold text-white">Kelly Benjamin De La Cruz</span>
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                KellyClipAi Studio (ShortStudio) · Compatible con Web, GitHub Actions y compilación
                nativa Windows (.exe) mediante Electron + FFmpeg + Whisper IA Local.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
