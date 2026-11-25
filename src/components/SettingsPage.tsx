import { useEffect, useState } from 'react';
import {
  Check,
  Cloud,
  Code2,
  Copy,
  Download,
  ExternalLink,
  HardDrive,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Trash2,
  User,
} from 'lucide-react';
import { CloudSyncStatus } from '../lib/supabase';
import { DesktopUpdateState } from '../types/desktop';
import {
  AiEngineMode,
  AppSettings,
  FitMode,
  SubtitlePresetId,
  TargetRatio,
  WhisperModelId,
} from '../types/editor';
import { getStorageEstimate } from '../utils/db';

const SUPABASE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS public.shortstudio_projects (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS public.shortstudio_scheduled_posts (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS public.shortstudio_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.shortstudio_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shortstudio_scheduled_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shortstudio_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shortstudio_projects_owner" ON public.shortstudio_projects FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "shortstudio_posts_owner" ON public.shortstudio_scheduled_posts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "shortstudio_settings_owner" ON public.shortstudio_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);`;

interface SettingsPageProps {
  settings: AppSettings;
  projectsCount: number;
  userEmail?: string | null;
  cloudSyncStatus?: CloudSyncStatus;
  cloudSyncDetail?: string;
  onSignOut?: () => void;
  desktopUpdateState?: DesktopUpdateState | null;
  onCheckForUpdates?: () => void;
  onDownloadUpdate?: () => void;
  onInstallUpdate?: () => void;
  onOpenReleasePage?: () => void;
  onUpdateSettings: (next: AppSettings) => void;
  onClearAllData: () => Promise<void>;
}

export function SettingsPage({
  settings,
  projectsCount,
  userEmail,
  cloudSyncStatus = 'idle',
  cloudSyncDetail,
  onSignOut,
  desktopUpdateState,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenReleasePage,
  onUpdateSettings,
  onClearAllData,
}: SettingsPageProps) {
  const [storage, setStorage] = useState<{ usedMB: number; quotaMB: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const isDesktopApp = Boolean(window.shortStudioDesktop?.isDesktop);

  useEffect(() => {
    getStorageEstimate().then(setStorage);
  }, [projectsCount]);

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 2200);
    } catch {
      // ignore clipboard restrictions
    }
  };

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
              <h2 className="text-sm font-semibold text-slate-100">
                {isDesktopApp ? 'Almacenamiento en Disco PC + IndexedDB' : 'Almacenamiento Local (IndexedDB)'}
              </h2>
              <p className="text-xs font-mono-tabular text-slate-400">
                {projectsCount} proyectos guardados
                {isDesktopApp
                  ? ' · Videos >250 MB guardados directo en disco local'
                  : storage
                  ? ` · ${storage.usedMB} MB usados de ${storage.quotaMB} MB disponibles`
                  : ''}
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
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">Cuenta y Nube Supabase</h2>
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                    cloudSyncStatus === 'synced'
                      ? 'text-emerald-400'
                      : cloudSyncStatus === 'tables-missing'
                      ? 'text-amber-300'
                      : 'text-slate-400'
                  }`}
                >
                  <Cloud className="w-3 h-3" />
                  <span>
                    {cloudSyncStatus === 'synced'
                      ? 'Nube sincronizada'
                      : cloudSyncStatus === 'tables-missing'
                      ? 'Solo almacenamiento local (faltan tablas SQL)'
                      : cloudSyncStatus === 'syncing'
                      ? 'Sincronizando...'
                      : 'Modo local activo'}
                  </span>
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {userEmail
                  ? `Sesión iniciada como ${userEmail}`
                  : 'Sesión de Supabase activa'}
              </p>
              {cloudSyncDetail && cloudSyncStatus === 'tables-missing' && (
                <p className="text-[11px] text-amber-200/80 max-w-lg leading-relaxed">
                  {cloudSyncDetail}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {cloudSyncStatus === 'tables-missing' && (
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-amber-200 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 cursor-pointer"
              >
                {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSql ? 'SQL Copiado' : 'Copiar SQL Supabase'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-200 bg-[#191d26] border border-slate-800 hover:bg-[#222733] cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </section>

        <section className="bg-[#12151c] border border-slate-800/90 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <RefreshCw className="w-5 h-5 text-indigo-400 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-100">
                Actualizaciones Automáticas (GitHub)
              </h2>
              {desktopUpdateState ? (
                <div className="space-y-1">
                  <p className="text-xs text-slate-300">
                    Versión instalada: <span className="font-mono-tabular font-semibold text-white">v{desktopUpdateState.currentVersion}</span>
                    {' · '}
                    {desktopUpdateState.isPortable ? 'Modo Portable (.exe)' : 'Instalador Windows'}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {desktopUpdateState.status === 'checking' && 'Buscando nuevos Releases en GitHub...'}
                    {desktopUpdateState.status === 'up-to-date' &&
                      `Estás al día con el último Release de ${desktopUpdateState.repo}.`}
                    {desktopUpdateState.status === 'available' &&
                      `Nueva versión v${desktopUpdateState.latestVersion} disponible en GitHub.`}
                    {desktopUpdateState.status === 'downloading' &&
                      `Descargando actualización v${desktopUpdateState.latestVersion} (${desktopUpdateState.progress}%)...`}
                    {desktopUpdateState.status === 'downloaded' &&
                      `Actualización v${desktopUpdateState.latestVersion} descargada y lista para instalar.`}
                    {desktopUpdateState.status === 'installing' &&
                      'Aplicando actualización y reiniciando...'}
                    {desktopUpdateState.status === 'error' &&
                      (desktopUpdateState.error || 'No se pudo verificar en GitHub.')}
                    {desktopUpdateState.status === 'idle' &&
                      `Repositorio: github.com/${desktopUpdateState.repo}`}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  Versión web <span className="font-mono-tabular text-slate-200">v{import.meta.env.VITE_APP_VERSION || '1.0.0'}</span> · La app de escritorio (.exe) se actualiza automáticamente al publicar nuevos Releases en GitHub.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {desktopUpdateState ? (
              <>
                {desktopUpdateState.status === 'available' && onDownloadUpdate && (
                  <button
                    type="button"
                    onClick={onDownloadUpdate}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar v{desktopUpdateState.latestVersion}</span>
                  </button>
                )}
                {desktopUpdateState.status === 'downloaded' && onInstallUpdate && (
                  <button
                    type="button"
                    onClick={onInstallUpdate}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Actualizar y reiniciar</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={
                    desktopUpdateState.status === 'checking' ||
                    desktopUpdateState.status === 'downloading' ||
                    desktopUpdateState.status === 'installing'
                  }
                  onClick={onCheckForUpdates}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-200 bg-[#191d26] border border-slate-800 hover:bg-[#222733] disabled:opacity-50 cursor-pointer"
                >
                  {desktopUpdateState.status === 'checking' ||
                  desktopUpdateState.status === 'downloading' ? (
                    <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>Buscar actualizaciones</span>
                </button>
                {onOpenReleasePage && (
                  <button
                    type="button"
                    onClick={onOpenReleasePage}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-slate-300 bg-[#0b0d11] border border-slate-800 hover:text-white cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Releases</span>
                  </button>
                )}
              </>
            ) : (
              <a
                href="https://github.com/elpirinpi/ShortStudio/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-200 bg-[#191d26] border border-slate-800 hover:bg-[#222733]"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Ver Releases (.exe)</span>
              </a>
            )}
          </div>
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
