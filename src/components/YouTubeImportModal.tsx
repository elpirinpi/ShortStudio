import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileVideo,
  FolderDown,
  LoaderCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { YouTubeBlockedInfo } from '../types/editor';
import {
  ConnectorStatus,
  isRunningInIframe,
  probeWindowsConnector,
} from '../utils/windowsConnector';

interface YouTubeImportModalProps {
  info: YouTubeBlockedInfo | null;
  connectorToken: string;
  connectorStatus: ConnectorStatus;
  downloading: boolean;
  progressPercent: number;
  progressLabel: string;
  errorMsg: string;
  onClose: () => void;
  onConnectorStatusChange: (status: ConnectorStatus) => void;
  onDownloadLauncher: () => void;
  onDownloadViaConnector: () => Promise<void>;
  onPickLocalFile: () => void;
}

export function YouTubeImportModal({
  info,
  connectorToken,
  connectorStatus,
  downloading,
  progressPercent,
  progressLabel,
  errorMsg,
  onClose,
  onConnectorStatusChange,
  onDownloadLauncher,
  onDownloadViaConnector,
  onPickLocalFile,
}: YouTubeImportModalProps) {
  const [launcherDownloaded, setLauncherDownloaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    if (!info) {
      setLauncherDownloaded(false);
      setCopiedUrl(false);
      return;
    }

    let canceled = false;
    const checkNow = async () => {
      const status = await probeWindowsConnector(connectorToken);
      if (!canceled) onConnectorStatusChange(status);
    };

    checkNow();
    const timer = window.setInterval(checkNow, 2000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [connectorToken, info, onConnectorStatusChange]);

  if (!info) return null;

  const inIframe = isRunningInIframe();
  const directAppUrl = typeof window !== 'undefined' ? window.location.href : '';

  const handleManualCheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const status = await probeWindowsConnector(connectorToken);
      onConnectorStatusChange(status);
    } finally {
      setChecking(false);
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(info.watchUrl || info.url);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2200);
    } catch {
      // ignore clipboard restrictions
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !downloading) onClose();
      }}
    >
      <div className="w-full max-w-xl bg-[#12151c] border border-white/[0.08] rounded-2xl divide-y divide-white/[0.06] shadow-2xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="p-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={info.thumbnailUrl}
              alt={info.title}
              referrerPolicy="no-referrer"
              className="w-16 h-10 rounded-lg object-cover border border-white/[0.08] shrink-0"
            />
            <div className="min-w-0 space-y-0.5">
              <h3 className="text-sm font-semibold text-white truncate">{info.title}</h3>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="truncate">{info.author}</span>
                <span aria-hidden="true">·</span>
                <span>Descarga MP4 en PC (Sin Cookies)</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={downloading}
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Explanation & Live Connector Status */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-300 leading-relaxed">
            YouTube bloquea descargas automáticas desde servidores en la nube, pero desde tu propia PC
            Windows descarga el <strong className="text-white">MP4 1080p sin cookies</strong>{' '}
            directamente a tu carpeta <strong className="text-slate-100">Descargas\ShortStudio</strong> y
            lo carga al editor.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-3 py-2.5 border-y border-white/[0.06]">
            <div className="flex items-center gap-2 text-xs">
              {connectorStatus.connected ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="font-medium text-emerald-300">
                    Conector Windows conectado
                  </span>
                  {connectorStatus.saveDir && (
                    <>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="text-slate-400 font-mono text-[11px] truncate max-w-[230px]">
                        {connectorStatus.saveDir}
                      </span>
                    </>
                  )}
                </>
              ) : connectorStatus.authMismatch ? (
                <>
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-amber-200">
                    Hay un conector antiguo abierto. Ciérralo y ejecuta el nuevo .bat.
                  </span>
                </>
              ) : (
                <>
                  <FolderDown className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-slate-300">
                    {launcherDownloaded
                      ? 'Esperando que abras ShortStudio-Conector-Windows.bat...'
                      : 'Conector Windows aún no iniciado'}
                  </span>
                </>
              )}
            </div>

            <button
              type="button"
              disabled={checking || downloading}
              onClick={handleManualCheck}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 disabled:opacity-45 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
              <span>Comprobar</span>
            </button>
          </div>

          {!connectorStatus.connected && !connectorStatus.authMismatch && inIframe && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-2.5">
              <p className="text-xs text-amber-100 leading-relaxed">
                <strong>¿Ya tienes la ventana negra abierta y sigue sin conectar?</strong> Tu
                navegador bloquea conexiones locales (<span className="font-mono">127.0.0.1</span>)
                dentro de la vista previa. Ábrelo en pestaña directa o pega el enlace en la ventana
                negra:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {directAppUrl && (
                  <a
                    href={directAppUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Abrir en pestaña directa</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#222836] cursor-pointer whitespace-nowrap"
                >
                  {copiedUrl ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Enlace copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copiar enlace para ventana negra</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Download 1-click launcher */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">
                1. Descarga y abre el Conector Windows (solo la primera vez)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Al darle doble clic prepara automáticamente <strong className="text-slate-300">yt-dlp</strong> y{' '}
              <strong className="text-slate-300">FFmpeg</strong> en tu PC (sin instalar Python ni Node.js).
              Deja su ventana abierta mientras descargas.
            </p>
            <button
              type="button"
              disabled={downloading}
              onClick={() => {
                onDownloadLauncher();
                setLauncherDownloaded(true);
              }}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-medium text-slate-100 bg-[#181c25] hover:bg-[#222836] disabled:opacity-45 cursor-pointer whitespace-nowrap transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>Descargar ShortStudio-Conector-Windows.bat</span>
            </button>
          </div>

          {downloading && (
            <div className="p-3.5 rounded-xl bg-[#0b0d12] border border-blue-500/35 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-2 font-medium text-slate-200 truncate">
                  <LoaderCircle className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                  <span className="truncate">{progressLabel || 'Descargando MP4 en tu PC...'}</span>
                </span>
                <span className="font-mono-tabular font-semibold text-blue-400 shrink-0">
                  {Math.max(0, Math.min(100, Math.round(progressPercent)))}%
                </span>
              </div>
              <div className="h-1.5 bg-[#161a24] rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-[width] duration-200"
                  style={{ width: `${Math.max(2, Math.min(100, progressPercent))}%` }}
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

        {/* Footer Actions */}
        <div className="p-5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={!connectorStatus.connected || downloading}
            onClick={onDownloadViaConnector}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
          >
            {downloading ? (
              <>
                <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                <span>
                  Descargando MP4 ({Math.max(0, Math.min(100, Math.round(progressPercent)))}%)...
                </span>
              </>
            ) : (
              <>
                <FolderDown className="w-3.5 h-3.5" />
                <span>Descargar MP4 en PC y Cargar</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={downloading}
            onClick={() => {
              onClose();
              onPickLocalFile();
            }}
            className="inline-flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-xl text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#222836] disabled:opacity-45 cursor-pointer whitespace-nowrap"
          >
            <FileVideo className="w-3.5 h-3.5 text-slate-400" />
            <span>Subir Archivo</span>
          </button>
        </div>
      </div>
    </div>
  );
}
