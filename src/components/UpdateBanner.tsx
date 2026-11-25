import { Download, ExternalLink, LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { DesktopUpdateState } from '../types/desktop';

interface UpdateBannerProps {
  updateState: DesktopUpdateState | null;
  onDownload: () => void;
  onInstall: () => void;
  onOpenRelease: () => void;
}

export function UpdateBanner({
  updateState,
  onDownload,
  onInstall,
  onOpenRelease,
}: UpdateBannerProps) {
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  if (!updateState) return null;

  const isVisibleStatus =
    updateState.status === 'available' ||
    updateState.status === 'downloading' ||
    updateState.status === 'downloaded' ||
    updateState.status === 'installing';

  if (!isVisibleStatus) return null;

  if (
    updateState.status === 'available' &&
    updateState.latestVersion &&
    dismissedVersion === updateState.latestVersion
  ) {
    return null;
  }

  return (
    <div className="bg-indigo-950/80 border-b border-indigo-500/40 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs text-indigo-100">
      <div className="flex items-center gap-2.5 min-w-0">
        {updateState.status === 'downloading' || updateState.status === 'installing' ? (
          <LoaderCircle className="w-4 h-4 text-indigo-300 animate-spin shrink-0" />
        ) : (
          <Sparkles className="w-4 h-4 text-indigo-300 shrink-0" />
        )}

        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {updateState.status === 'available' && (
            <span>
              Nueva versión <strong className="text-white">v{updateState.latestVersion}</strong>{' '}
              disponible en GitHub (actual: v{updateState.currentVersion}).
            </span>
          )}
          {updateState.status === 'downloading' && (
            <span>
              Descargando actualización <strong className="text-white">v{updateState.latestVersion}</strong>{' '}
              ({updateState.progress}%)...
            </span>
          )}
          {updateState.status === 'downloaded' && (
            <span>
              Actualización <strong className="text-white">v{updateState.latestVersion}</strong>{' '}
              descargada y lista para instalar.
            </span>
          )}
          {updateState.status === 'installing' && (
            <span>Aplicando actualización y reiniciando KellyClipAi Studio...</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {updateState.status === 'downloading' && (
          <div className="w-28 h-1.5 bg-indigo-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-400 transition-all duration-200"
              style={{ width: `${updateState.progress}%` }}
            />
          </div>
        )}

        {updateState.status === 'available' && (
          <>
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold bg-indigo-500 hover:bg-indigo-400 text-white cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar actualización</span>
            </button>
            <button
              type="button"
              onClick={onOpenRelease}
              title="Ver Release en GitHub"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-indigo-200 hover:text-white hover:bg-indigo-900/60 cursor-pointer"
            >
              <ExternalLink className="w-3 h-3" />
              <span>GitHub</span>
            </button>
            <button
              type="button"
              onClick={() => setDismissedVersion(updateState.latestVersion)}
              aria-label="Ocultar aviso"
              className="p-1 rounded text-indigo-300 hover:text-white hover:bg-indigo-900/60 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        )}

        {updateState.status === 'downloaded' && (
          <button
            type="button"
            onClick={onInstall}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualizar y reiniciar</span>
          </button>
        )}
      </div>
    </div>
  );
}
