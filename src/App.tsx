import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ClipEditorHandle, ClipEditorWorkspace } from './components/ClipEditorWorkspace';
import { CreatePage, StagedMediaInfo } from './components/CreatePage';
import { LoginScreen } from './components/LoginScreen';
import { ManualClipModal } from './components/ManualClipModal';
import { ProjectsPage } from './components/ProjectsPage';
import { RecordModal } from './components/RecordModal';
import { ResultsPage } from './components/ResultsPage';
import { SchedulerPage } from './components/SchedulerPage';
import { SettingsPage } from './components/SettingsPage';
import { TopNav } from './components/TopNav';
import { UpdateBanner } from './components/UpdateBanner';
import { YouTubeImportModal } from './components/YouTubeImportModal';
import { DesktopUpdateState } from './types/desktop';
import {
  CloudSyncStatus,
  checkCloudSyncHealth,
  deleteCloudProject,
  deleteCloudScheduledPost,
  fetchCloudAppSettings,
  fetchCloudProjects,
  fetchCloudScheduledPosts,
  isSupabaseConfigured,
  supabase,
  upsertCloudAppSettings,
  upsertCloudProject,
  upsertCloudScheduledPost,
} from './lib/supabase';
import {
  AiEngineMode,
  AppSettings,
  AppView,
  ClipProject,
  DEFAULT_APP_SETTINGS,
  EditorSettings,
  ProjectConfig,
  ScheduledPost,
  SubtitleCue,
  YouTubeBlockedInfo,
} from './types/editor';
import {
  clearAllStudioData,
  deleteProject,
  deleteScheduledPost,
  getAllProjects,
  getAllScheduledPosts,
  getAppSettings,
  getMediaBlob,
  saveAppSettings,
  saveMediaBlob,
  saveProject,
  saveScheduledPost,
} from './utils/db';
import {
  analyzeVideoLocally,
  createDemoProject,
  createManualClip,
  createManualProjectShell,
  extractVideoMetadataAndThumbnail,
  transcribeVideoRange,
  transcriptToSubtitles,
} from './utils/localAi';
import {
  ConnectorStatus,
  downloadViaWindowsConnector,
  downloadWindowsConnectorLauncher,
  ensureConnectorToken,
  generateConnectorToken,
  probeWindowsConnector,
  saveBlobToPcDownloads,
} from './utils/windowsConnector';

function buildConfigFromSettings(s: AppSettings): ProjectConfig {
  return {
    ratio: s.defaultRatio,
    framing: s.defaultFraming,
    targetDuration: 'auto',
    language: s.defaultLanguage,
    subtitlePreset: s.defaultPreset,
    generateProgressBar: true,
    autoFaceTrack: true,
  };
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('create');
  const [projects, setProjects] = useState<ClipProject[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>(() =>
    buildConfigFromSettings(DEFAULT_APP_SETTINGS)
  );

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [activeMediaUrl, setActiveMediaUrl] = useState<string | null>(null);
  const activeMediaUrlRef = useRef<string | null>(null);
  const activeMediaIsObjectUrlRef = useRef<boolean>(false);
  const [mediaRefreshTick, setMediaRefreshTick] = useState(0);

  const [stagedMedia, setStagedMedia] = useState<StagedMediaInfo | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStep, setAnalysisStep] = useState('');
  const [createError, setCreateError] = useState('');
  const [retranscribing, setRetranscribing] = useState(false);
  const [retranscribeStatus, setRetranscribeStatus] = useState('');

  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [manualClipProjectId, setManualClipProjectId] = useState<string | null>(null);
  const [manualCreating, setManualCreating] = useState(false);
  const [manualProgressPct, setManualProgressPct] = useState(0);
  const [manualProgressLabel, setManualProgressLabel] = useState('');
  const [manualModalError, setManualModalError] = useState('');
  const [ytBlockedInfo, setYtBlockedInfo] = useState<YouTubeBlockedInfo | null>(null);
  const [connectorStatus, setConnectorStatus] = useState<ConnectorStatus>({ connected: false });
  const [connectorDownloading, setConnectorDownloading] = useState(false);
  const [connectorProgressPercent, setConnectorProgressPercent] = useState(0);
  const [connectorProgressLabel, setConnectorProgressLabel] = useState('');
  const [connectorModalError, setConnectorModalError] = useState('');
  const [urlStatusText, setUrlStatusText] = useState('');
  const [urlProgressPercent, setUrlProgressPercent] = useState(0);
  const activeImportJobIdRef = useRef<string | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const importCanceledRef = useRef<boolean>(false);
  const quickFileInputRef = useRef<HTMLInputElement | null>(null);
  const [schedulerTarget, setSchedulerTarget] = useState<{
    projectId: string;
    clipId: string;
  } | null>(null);

  const [editorExportState, setEditorExportState] = useState({
    isExporting: false,
    canExport: false,
  });
  const editorRef = useRef<ClipEditorHandle | null>(null);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(isSupabaseConfigured);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>(
    isSupabaseConfigured ? 'idle' : 'offline'
  );
  const [cloudSyncDetail, setCloudSyncDetail] = useState<string>('');
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);

  const notify = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 2800);
  }, []);

  useEffect(() => {
    const bridge = window.shortStudioDesktop;
    if (!bridge?.isDesktop) return;
    let mounted = true;
    bridge
      .getUpdateState()
      .then((state) => {
        if (mounted) setDesktopUpdateState(state);
      })
      .catch(() => {});
    const unsubscribe = bridge.onUpdateState((state) => {
      if (mounted) setDesktopUpdateState(state);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const handleCheckForUpdates = useCallback(() => {
    const bridge = window.shortStudioDesktop;
    if (!bridge?.isDesktop) return;
    void bridge.checkForUpdates().then((state) => {
      setDesktopUpdateState(state);
      if (state.status === 'up-to-date') {
        notify(`Ya tienes la última versión (v${state.currentVersion})`);
      } else if (state.status === 'error' && state.error) {
        notify(state.error);
      }
    });
  }, [notify]);

  const handleDownloadUpdate = useCallback(() => {
    const bridge = window.shortStudioDesktop;
    if (!bridge?.isDesktop) return;
    void bridge.downloadUpdate();
  }, []);

  const handleInstallUpdate = useCallback(() => {
    const bridge = window.shortStudioDesktop;
    if (!bridge?.isDesktop) return;
    void bridge.installUpdate().then((res) => {
      if (!res.ok && res.error) notify(res.error);
    });
  }, [notify]);

  const handleOpenReleasePage = useCallback(() => {
    void window.shortStudioDesktop?.openReleasePage();
  }, []);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setAuthSession(data.session ?? null);
        setAuthLoading(false);
      })
      .catch(() => {
        if (mounted) setAuthLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setAuthSession(session ?? null);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    setAuthSession(null);
    notify('Sesión cerrada');
  }, [notify]);

  // Load initial IndexedDB state
  useEffect(() => {
    let mounted = true;
    Promise.all([getAllProjects(), getAllScheduledPosts(), getAppSettings()])
      .then(([loadedProjects, loadedPosts, loadedSettings]) => {
        if (!mounted) return;
        const { updatedSettings } = ensureConnectorToken(loadedSettings);
        const effectiveSettings = updatedSettings || loadedSettings;
        if (updatedSettings) {
          saveAppSettings(updatedSettings).catch(() => {});
        }
        setProjects(loadedProjects);
        setScheduledPosts(loadedPosts);
        setAppSettings(effectiveSettings);
        setProjectConfig(buildConfigFromSettings(effectiveSettings));
        if (loadedProjects.length > 0) {
          setActiveProjectId(loadedProjects[0].id);
          setActiveClipId(loadedProjects[0].clips[0]?.id ?? null);
        }
      })
      .catch(() => {
        // Ignore IDB init failures in restricted private browsing
      });

    return () => {
      mounted = false;
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Optional Supabase cloud metadata sync + health check when authenticated
  useEffect(() => {
    const userId = authSession?.user?.id;
    if (!userId || !isSupabaseConfigured) {
      setCloudSyncStatus(isSupabaseConfigured ? 'idle' : 'offline');
      return;
    }

    let canceled = false;
    setCloudSyncStatus('syncing');
    Promise.all([
      checkCloudSyncHealth(userId),
      fetchCloudProjects(userId),
      fetchCloudScheduledPosts(userId),
      fetchCloudAppSettings(userId),
    ])
      .then(([health, cloudProjects, cloudPosts, cloudSettings]) => {
        if (canceled) return;
        setCloudSyncStatus(health.status);
        setCloudSyncDetail(health.detail || '');

        if (cloudProjects.length > 0) {
          setProjects((prev) => {
            const byId = new Map(prev.map((p) => [p.id, p]));
            for (const cp of cloudProjects) {
              const local = byId.get(cp.id);
              if (
                !local ||
                new Date(cp.updatedAt).getTime() > new Date(local.updatedAt).getTime()
              ) {
                byId.set(cp.id, cp);
                saveProject(cp).catch(() => {});
              }
            }
            return [...byId.values()].sort(
              (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
          });
        }

        if (cloudPosts.length > 0) {
          setScheduledPosts((prev) => {
            const byId = new Map(prev.map((p) => [p.id, p]));
            for (const cp of cloudPosts) {
              if (!byId.has(cp.id)) {
                byId.set(cp.id, cp);
                saveScheduledPost(cp).catch(() => {});
              }
            }
            return [...byId.values()].sort(
              (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
            );
          });
        }

        if (cloudSettings) {
          setAppSettings((prev) => {
            const merged = { ...prev, ...cloudSettings };
            saveAppSettings(merged).catch(() => {});
            setProjectConfig(buildConfigFromSettings(merged));
            return merged;
          });
        }
      })
      .catch(() => {
        if (!canceled) {
          setCloudSyncStatus('error');
          setCloudSyncDetail('No se pudo conectar con Supabase');
        }
      });

    return () => {
      canceled = true;
    };
  }, [authSession?.user?.id]);

  const connectorToken = useMemo(
    () => appSettings.localConnectorToken || generateConnectorToken(),
    [appSettings.localConnectorToken]
  );

  const isDesktopApp = Boolean(window.shortStudioDesktop?.isDesktop);

  useEffect(() => {
    if (isDesktopApp || activeView !== 'create' || !appSettings.localConnectorToken) return;
    let canceled = false;
    const probe = async () => {
      const status = await probeWindowsConnector(appSettings.localConnectorToken || '');
      if (!canceled) setConnectorStatus(status);
    };
    probe();
    const timer = window.setInterval(probe, 5000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [activeView, appSettings.localConnectorToken, isDesktopApp]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  // Hydrate playback URL for active project's media (ObjectURL on Web, HTTP Range URL on Desktop)
  useEffect(() => {
    let canceled = false;

    const cleanupUrl = () => {
      if (activeMediaUrlRef.current && activeMediaIsObjectUrlRef.current) {
        URL.revokeObjectURL(activeMediaUrlRef.current);
      }
      activeMediaUrlRef.current = null;
      activeMediaIsObjectUrlRef.current = false;
    };

    const blobId = activeProject?.mediaBlobId;
    if (!blobId || activeProject?.isDemo) {
      cleanupUrl();
      setActiveMediaUrl(null);
      return;
    }

    getMediaBlob(blobId)
      .then((record) => {
        if (canceled) return;
        cleanupUrl();
        if (record?.url) {
          activeMediaUrlRef.current = record.url;
          activeMediaIsObjectUrlRef.current = false;
          setActiveMediaUrl(record.url);
        } else if (record?.blob) {
          const url = URL.createObjectURL(record.blob);
          activeMediaUrlRef.current = url;
          activeMediaIsObjectUrlRef.current = true;
          setActiveMediaUrl(url);
        } else {
          setActiveMediaUrl(null);
        }
      })
      .catch(() => {
        if (!canceled) setActiveMediaUrl(null);
      });

    return () => {
      canceled = true;
    };
  }, [activeProject?.id, activeProject?.mediaBlobId, activeProject?.isDemo, mediaRefreshTick]);

  useEffect(() => {
    return () => {
      if (activeMediaUrlRef.current && activeMediaIsObjectUrlRef.current) {
        URL.revokeObjectURL(activeMediaUrlRef.current);
      }
      activeMediaUrlRef.current = null;
      activeMediaIsObjectUrlRef.current = false;
    };
  }, []);

  const stageVideoBlob = useCallback(
    async (blob: Blob, name: string, savedPcPath?: string) => {
      setCreateError('');
      try {
        const meta = await extractVideoMetadataAndThumbnail(blob);
        setStagedMedia({
          file: blob,
          name,
          size: blob.size,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          thumbnailDataUrl: meta.thumbnailDataUrl,
          savedPcPath,
        });
        notify(savedPcPath ? `MP4 guardado en PC y listo: ${name}` : `Video listo: ${name}`);
      } catch (err) {
        setCreateError(
          err instanceof Error
            ? err.message
            : 'No se pudo leer el video. Usa formato MP4, MOV o WebM.'
        );
      }
    },
    [notify]
  );

  const handleSelectFile = useCallback(
    (file: File) => {
      if (
        !file.type.startsWith('video/') &&
        !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)
      ) {
        setCreateError('Selecciona un archivo de video válido (MP4, MOV o WebM).');
        return;
      }
      stageVideoBlob(file, file.name);
    },
    [stageVideoBlob]
  );

  const importVideoViaBackend = useCallback(
    async (
      url: string
    ): Promise<{ ok: boolean; canceled?: boolean; blocked?: YouTubeBlockedInfo; error?: string }> => {
      let maxPercent = 3;
      const pushProgress = (pct: number, label?: string) => {
        maxPercent = Math.max(maxPercent, Math.min(100, Math.round(pct)));
        setUrlProgressPercent(maxPercent);
        if (label) setUrlStatusText(label);
      };

      const controller = new AbortController();
      importAbortRef.current = controller;
      importCanceledRef.current = false;
      activeImportJobIdRef.current = null;

      try {
        const startRes = await fetch('/api/import-url/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, saveToPc: isDesktopApp }),
          signal: controller.signal,
        });

        if (!startRes.ok) {
          const errData = (await startRes.json().catch(() => ({}))) as { error?: string };
          return {
            ok: false,
            error: errData.error || `El servidor respondió con estado ${startRes.status}.`,
          };
        }

        const { jobId } = (await startRes.json().catch(() => ({}))) as { jobId?: string };
        if (!jobId) {
          return { ok: false, error: 'El servidor no devolvió un identificador de descarga.' };
        }
        activeImportJobIdRef.current = jobId;

        // Poll live download progress from yt-dlp / FFmpeg / direct stream
        let transientErrors = 0;
        while (true) {
          if (importCanceledRef.current || controller.signal.aborted) {
            return { ok: false, canceled: true };
          }
          await new Promise((r) => setTimeout(r, 350));
          if (importCanceledRef.current || controller.signal.aborted) {
            return { ok: false, canceled: true };
          }

          const stRes = await fetch(`/api/import-url/${encodeURIComponent(jobId)}/status`, {
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!stRes.ok) {
            transientErrors += 1;
            if (stRes.status === 404 || transientErrors >= 4) {
              const errData = (await stRes.json().catch(() => ({}))) as { error?: string };
              return {
                ok: false,
                error: errData.error || `Error consultando progreso (${stRes.status}).`,
              };
            }
            continue;
          }
          transientErrors = 0;

          const st = (await stRes.json()) as {
            status: 'running' | 'ready' | 'blocked' | 'canceled' | 'error';
            percent?: number;
            label?: string;
            blocked?: Partial<YouTubeBlockedInfo> & { videoId?: string };
            error?: string;
          };

          if (typeof st.percent === 'number') {
            pushProgress(st.percent, st.label);
          } else if (st.label) {
            setUrlStatusText(st.label);
          }

          if (st.status === 'canceled') {
            return { ok: false, canceled: true };
          }

          const blockedVideoId = st.blocked?.videoId;
          if (st.status === 'blocked' && blockedVideoId && st.blocked) {
            const b = st.blocked;
            return {
              ok: false,
              blocked: {
                url,
                videoId: blockedVideoId,
                title: b.title || `YouTube_${blockedVideoId}`,
                author: b.author || 'YouTube',
                thumbnailUrl:
                  b.thumbnailUrl || `https://i.ytimg.com/vi/${blockedVideoId}/hqdefault.jpg`,
                embedUrl:
                  b.embedUrl || `https://www.youtube.com/embed/${blockedVideoId}?rel=0&playsinline=1`,
                watchUrl: b.watchUrl || `https://www.youtube.com/watch?v=${blockedVideoId}`,
                reason: b.reason || 'YouTube solicitó verificación anti-bot.',
              },
            };
          }

          if (st.status === 'error') {
            return {
              ok: false,
              error: st.error || 'No se pudo importar el video desde esa URL.',
            };
          }

          if (st.status === 'ready') {
            break;
          }
        }

        // Download completed file into browser memory / editor
        pushProgress(Math.max(maxPercent, 96), 'Transfiriendo MP4 al editor...');
        const res = await fetch(`/api/import-url/${encodeURIComponent(jobId)}/file`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          return {
            ok: false,
            error: errData.error || `No se pudo transferir el video (${res.status}).`,
          };
        }

        const totalBytes = Number(res.headers.get('content-length') || 0);
        let blob: Blob;
        if (res.body && typeof res.body.getReader === 'function') {
          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let loaded = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (importCanceledRef.current || controller.signal.aborted) {
              return { ok: false, canceled: true };
            }
            if (value) {
              chunks.push(value);
              loaded += value.byteLength;
              if (totalBytes > 0) {
                const transferPct = 96 + Math.round((loaded / totalBytes) * 3);
                pushProgress(
                  Math.min(99, transferPct),
                  `Cargando MP4 en el editor... (${(loaded / (1024 * 1024)).toFixed(1)} / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB)`
                );
              }
            }
          }
          blob = new Blob(chunks as BlobPart[], {
            type: res.headers.get('content-type') || 'video/mp4',
          });
        } else {
          blob = await res.blob();
        }

        if (blob.size === 0) {
          return { ok: false, error: 'El video descargado está vacío.' };
        }

        pushProgress(100, 'Video listo en el editor');
        const headerTitle = res.headers.get('x-video-title');
        const decodedTitle = headerTitle ? decodeURIComponent(headerTitle) : '';
        const headerSavedPc = res.headers.get('x-saved-pc-path');
        const savedPcPath = headerSavedPc ? decodeURIComponent(headerSavedPc) : undefined;
        const rawName = decodedTitle
          ? /\.(mp4|webm|mov|m4v)$/i.test(decodedTitle)
            ? decodedTitle
            : `${decodedTitle}.mp4`
          : url.split('/').pop()?.split('?')[0] || `video_${Date.now()}.mp4`;

        await stageVideoBlob(blob, rawName, savedPcPath);
        return { ok: true };
      } catch (err) {
        if (
          importCanceledRef.current ||
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return { ok: false, canceled: true };
        }
        throw err;
      } finally {
        activeImportJobIdRef.current = null;
        if (importAbortRef.current === controller) {
          importAbortRef.current = null;
        }
      }
    },
    [isDesktopApp, stageVideoBlob]
  );

  const handleCancelImportUrl = useCallback(() => {
    importCanceledRef.current = true;
    const jobId = activeImportJobIdRef.current;
    if (importAbortRef.current) {
      importAbortRef.current.abort();
      importAbortRef.current = null;
    }
    if (jobId) {
      fetch(`/api/import-url/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }).catch(() => {});
      activeImportJobIdRef.current = null;
    }
    setUrlStatusText('');
    setUrlProgressPercent(0);
    setCreateError('');
    notify('Descarga cancelada');
  }, [notify]);

  const handleDownloadLauncher = useCallback(() => {
    let token = appSettings.localConnectorToken;
    if (!token) {
      const next = { ...appSettings, localConnectorToken: connectorToken };
      setAppSettings(next);
      saveAppSettings(next).catch(() => {});
      token = connectorToken;
    }
    downloadWindowsConnectorLauncher(token);
    notify('Lanzador descargado: ábrelo con doble clic en Windows');
  }, [appSettings, connectorToken, notify]);

  const handleImportUrl = useCallback(
    async (url: string): Promise<boolean> => {
      setCreateError('');
      setConnectorModalError('');
      importCanceledRef.current = false;
      setUrlProgressPercent(2);
      setUrlStatusText(
        isDesktopApp
          ? 'Iniciando descarga MP4 1080p en tu PC...'
          : 'Comprobando Conector Local Windows...'
      );

      try {
        if (!isDesktopApp) {
          // 1. In Web mode, prefer local Windows PC connector when running (residential IP, saves MP4 directly)
          const liveStatus = await probeWindowsConnector(connectorToken);
          setConnectorStatus(liveStatus);

          if (liveStatus.connected) {
            setUrlProgressPercent(4);
            setUrlStatusText('Iniciando descarga MP4 1080p en tu PC...');
            const pcRes = await downloadViaWindowsConnector(url, connectorToken, (prog) => {
              setUrlProgressPercent(prog.percent);
              setUrlStatusText(prog.label);
            });
            if (pcRes.ok) {
              await stageVideoBlob(pcRes.blob, pcRes.fileName, pcRes.savedPath);
              return true;
            }
            if (!pcRes.unreachable) {
              setCreateError(pcRes.error);
              return false;
            }
          }
        }

        // 2. Embedded PC backend (in Desktop .exe) or server extractor (in Web)
        setUrlProgressPercent(3);
        setUrlStatusText(
          isDesktopApp
            ? 'Iniciando descarga MP4 1080p con motor integrado...'
            : 'Iniciando descarga desde el servidor...'
        );
        const result = await importVideoViaBackend(url);
        if (result.ok) {
          return true;
        }
        if (result.canceled) {
          return false;
        }
        if (result.blocked) {
          setYtBlockedInfo(result.blocked);
          return false;
        }
        setCreateError(result.error || 'No se pudo importar el video desde esa URL.');
        return false;
      } catch (err) {
        if (
          importCanceledRef.current ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return false;
        }
        setCreateError(
          err instanceof Error
            ? `No se pudo importar desde esa URL (${err.message}).`
            : 'No se pudo importar el video desde la URL.'
        );
        return false;
      } finally {
        setUrlStatusText('');
        setUrlProgressPercent(0);
      }
    },
    [connectorToken, importVideoViaBackend, isDesktopApp, stageVideoBlob]
  );

  const handleDownloadBlockedWithConnector = useCallback(async () => {
    if (!ytBlockedInfo || connectorDownloading) return;
    setConnectorModalError('');
    setConnectorDownloading(true);
    setConnectorProgressPercent(2);
    setConnectorProgressLabel('Iniciando descarga en tu PC...');
    try {
      const pcRes = await downloadViaWindowsConnector(
        ytBlockedInfo.url,
        connectorToken,
        (prog) => {
          setConnectorProgressPercent(prog.percent);
          setConnectorProgressLabel(prog.label);
        }
      );
      if (pcRes.ok) {
        await stageVideoBlob(pcRes.blob, pcRes.fileName, pcRes.savedPath);
        setYtBlockedInfo(null);
        setActiveView('create');
        return;
      }
      setConnectorModalError(pcRes.error);
    } finally {
      setConnectorDownloading(false);
      setConnectorProgressPercent(0);
      setConnectorProgressLabel('');
    }
  }, [connectorDownloading, connectorToken, stageVideoBlob, ytBlockedInfo]);

  const handleSaveStagedToPc = useCallback(() => {
    if (!stagedMedia) return;
    saveBlobToPcDownloads(stagedMedia.file, stagedMedia.name);
    notify('Descargando copia MP4 a tu PC');
  }, [notify, stagedMedia]);

  const handleUpdateConfig = useCallback(
    <K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K]) => {
      setProjectConfig((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleChangeAiEngine = useCallback(
    (engine: AiEngineMode) => {
      setAppSettings((prev) => {
        const next = { ...prev, aiEngine: engine };
        saveAppSettings(next).catch(() => {});
        return next;
      });
    },
    []
  );

  const handleAnalyze = useCallback(async () => {
    if (!stagedMedia || analyzing) return;
    setCreateError('');
    setAnalyzing(true);
    setAnalysisProgress(4);
    setAnalysisStep('Guardando video en almacenamiento local...');

    try {
      const mediaBlobId = `media_${Date.now()}`;
      await saveMediaBlob(mediaBlobId, stagedMedia.file, stagedMedia.name);

      const cleanTitle = stagedMedia.name.replace(/\.[^/.]+$/, '') || 'Nuevo Proyecto';
      const project = await analyzeVideoLocally({
        blob: stagedMedia.file,
        title: cleanTitle,
        mediaBlobId,
        config: projectConfig,
        aiEngine: appSettings.aiEngine,
        whisperModel: appSettings.whisperModel,
        onProgress: (pct, stepText) => {
          setAnalysisProgress(pct);
          setAnalysisStep(stepText);
        },
      });

      await saveProject(project);
      if (authSession?.user?.id) {
        void upsertCloudProject(authSession.user.id, project);
      }
      setProjects((prev) => [project, ...prev]);
      setActiveProjectId(project.id);
      setActiveClipId(project.clips[0]?.id ?? null);
      setStagedMedia(null);
      setActiveView('results');
      notify(`${project.clips.length} clips generados sin costo`);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Ocurrió un error al analizar el video localmente.'
      );
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, appSettings.aiEngine, appSettings.whisperModel, authSession?.user?.id, notify, projectConfig, stagedMedia]);

  const handleStartManualClips = useCallback(async () => {
    if (!stagedMedia || analyzing) return;
    setCreateError('');
    setAnalyzing(true);
    setAnalysisProgress(25);
    setAnalysisStep('Guardando video para edición manual...');

    try {
      const mediaBlobId = `media_${Date.now()}`;
      await saveMediaBlob(mediaBlobId, stagedMedia.file, stagedMedia.name);
      setAnalysisProgress(70);
      setAnalysisStep('Preparando proyecto manual...');

      const cleanTitle = stagedMedia.name.replace(/\.[^/.]+$/, '') || 'Proyecto Manual';
      const project = await createManualProjectShell({
        blob: stagedMedia.file,
        title: cleanTitle,
        mediaBlobId,
        config: projectConfig,
      });

      await saveProject(project);
      if (authSession?.user?.id) {
        void upsertCloudProject(authSession.user.id, project);
      }
      setProjects((prev) => [project, ...prev]);
      setActiveProjectId(project.id);
      setActiveClipId(null);
      setStagedMedia(null);
      setActiveView('results');
      setManualModalError('');
      setManualClipProjectId(project.id);
      notify('Selecciona los puntos de corte para tu primer clip manual');
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'No se pudo preparar el video para edición manual.'
      );
    } finally {
      setAnalyzing(false);
      setAnalysisProgress(0);
      setAnalysisStep('');
    }
  }, [analyzing, authSession?.user?.id, notify, projectConfig, stagedMedia]);

  const handleOpenManualClipModal = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setManualModalError('');
    setManualProgressPct(0);
    setManualProgressLabel('');
    setManualClipProjectId(projectId);
  }, []);

  const handleCreateManualClip = useCallback(
    async (params: {
      projectId: string;
      start: number;
      end: number;
      title: string;
      transcribeAudio: boolean;
      trackFaces: boolean;
      openInEditor: boolean;
    }) => {
      const targetProj = projects.find((p) => p.id === params.projectId);
      if (!targetProj || manualCreating) return;

      setManualModalError('');
      setManualCreating(true);
      setManualProgressPct(5);
      setManualProgressLabel('Preparando clip manual...');

      try {
        const record = targetProj.mediaBlobId
          ? await getMediaBlob(targetProj.mediaBlobId)
          : null;
        const source: Blob | string | null =
          record?.blob || record?.url || (targetProj.id === activeProjectId ? activeMediaUrl : null);

        const { clip, addedTranscript } = await createManualClip({
          project: targetProj,
          start: params.start,
          end: params.end,
          title: params.title,
          source,
          whisperModel: appSettings.whisperModel,
          transcribeAudio: params.transcribeAudio,
          trackFaces: params.trackFaces,
          onProgress: (pct, msg) => {
            setManualProgressPct(pct);
            setManualProgressLabel(msg);
          },
        });

        const mergedTranscript =
          addedTranscript.length > 0
            ? [...targetProj.transcript, ...addedTranscript].sort((a, b) => a.start - b.start)
            : targetProj.transcript;

        const updatedProj: ClipProject = {
          ...targetProj,
          updatedAt: new Date().toISOString(),
          transcript: mergedTranscript,
          clips: [...targetProj.clips, clip],
        };

        await saveProject(updatedProj).catch(() => {});
        if (authSession?.user?.id) {
          void upsertCloudProject(authSession.user.id, updatedProj);
        }

        setProjects((prev) => prev.map((p) => (p.id === updatedProj.id ? updatedProj : p)));
        setActiveProjectId(updatedProj.id);
        setActiveClipId(clip.id);
        setManualClipProjectId(null);

        if (params.openInEditor) {
          setActiveView('editor');
        }
        notify(`Clip manual creado (${clip.duration.toFixed(1)}s)`);
      } catch (err) {
        setManualModalError(
          err instanceof Error ? err.message : 'No se pudo crear el clip manual.'
        );
      } finally {
        setManualCreating(false);
        setManualProgressPct(0);
        setManualProgressLabel('');
      }
    },
    [
      activeMediaUrl,
      activeProjectId,
      appSettings.whisperModel,
      authSession?.user?.id,
      manualCreating,
      notify,
      projects,
    ]
  );

  const handleDeleteClip = useCallback(
    (projectId: string, clipId: string) => {
      setProjects((prev) =>
        prev.map((proj) => {
          if (proj.id !== projectId) return proj;
          const remainingClips = proj.clips.filter((c) => c.id !== clipId);
          const updated: ClipProject = {
            ...proj,
            updatedAt: new Date().toISOString(),
            clips: remainingClips,
          };
          saveProject(updated).catch(() => {});
          if (authSession?.user?.id) {
            void upsertCloudProject(authSession.user.id, updated);
          }
          if (activeClipId === clipId) {
            setActiveClipId(remainingClips[0]?.id ?? null);
          }
          return updated;
        })
      );
      setScheduledPosts((prev) => prev.filter((post) => post.clipId !== clipId));
      notify('Clip eliminado');
    },
    [activeClipId, authSession?.user?.id, notify]
  );

  const handleRunDemoProject = useCallback(async () => {
    const demoProj = createDemoProject(projectConfig);
    await saveProject(demoProj).catch(() => {});
    if (authSession?.user?.id) {
      void upsertCloudProject(authSession.user.id, demoProj);
    }
    setProjects((prev) => [demoProj, ...prev]);
    setActiveProjectId(demoProj.id);
    setActiveClipId(demoProj.clips[0]?.id ?? null);
    setActiveView('results');
    notify('Proyecto demo cargado');
  }, [authSession?.user?.id, notify, projectConfig]);

  const handleOpenResults = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setActiveView('results');
  }, []);

  const handleRetranscribeProject = useCallback(
    async (projectId: string) => {
      const targetProj = projects.find((p) => p.id === projectId);
      if (!targetProj || targetProj.isDemo || retranscribing) return;

      setRetranscribing(true);
      setRetranscribeStatus('Preparando audio...');
      try {
        const record = targetProj.mediaBlobId ? await getMediaBlob(targetProj.mediaBlobId) : null;
        const source: Blob | string | null =
          record?.blob || record?.url || (targetProj.id === activeProjectId ? activeMediaUrl : null);
        if (!source) {
          notify('No se encontró el archivo de video local para transcribir');
          return;
        }

        const result = await transcribeVideoRange({
          source,
          start: 0,
          end: targetProj.duration,
          language: targetProj.config.language,
          modelId: appSettings.whisperModel,
          wordsPerBlock: 3,
          onProgress: (pct, label) => {
            setRetranscribeStatus(`${pct}% · ${label}`);
          },
        });

        const updatedClips = targetProj.clips.map((clip, idx) => {
          const newSubs = transcriptToSubtitles(result.transcript, clip.start, clip.end, 3);
          const snippet =
            newSubs.length > 0
              ? newSubs.map((s) => s.text.replace(/\*/g, '')).join(' ')
              : result.transcript
                  .filter((seg) => seg.end >= clip.start && seg.start <= clip.end)
                  .map((seg) => seg.text)
                  .join(' ') || clip.transcriptSnippet;

          const isGenericTitle =
            /^Momento Destacado/i.test(clip.title) || /^Clip #/i.test(clip.title);
          const cleanedSnippetWords = snippet.trim().split(/\s+/).filter(Boolean);
          const nextTitle =
            isGenericTitle &&
            cleanedSnippetWords.length >= 2 &&
            !/^Segmento de voz/i.test(snippet)
              ? cleanedSnippetWords.slice(0, 6).join(' ') +
                (cleanedSnippetWords.length > 6 ? '...' : '')
              : clip.title || `Momento Destacado #${idx + 1}`;

          return {
            ...clip,
            title: nextTitle,
            subtitles: newSubs.length > 0 ? newSubs : clip.subtitles,
            transcriptSnippet: snippet,
          };
        });

        const updatedProj: ClipProject = {
          ...targetProj,
          updatedAt: new Date().toISOString(),
          aiEngineUsed: result.engineUsed,
          transcript: result.transcript,
          clips: updatedClips,
        };

        await saveProject(updatedProj).catch(() => {});
        if (authSession?.user?.id) {
          void upsertCloudProject(authSession.user.id, updatedProj);
        }
        setProjects((prev) => prev.map((p) => (p.id === updatedProj.id ? updatedProj : p)));
        notify(`Transcripción completada (${result.transcript.length} segmentos)`);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Error al transcribir con Whisper local');
      } finally {
        setRetranscribing(false);
        setRetranscribeStatus('');
      }
    },
    [
      activeMediaUrl,
      activeProjectId,
      appSettings.whisperModel,
      authSession?.user?.id,
      notify,
      projects,
      retranscribing,
    ]
  );

  const handleRelinkProjectMedia = useCallback(
    async (projectId: string, file: File) => {
      if (
        !file.type.startsWith('video/') &&
        !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)
      ) {
        notify('Selecciona un archivo de video válido (MP4, MOV o WebM)');
        return;
      }
      const target = projects.find((p) => p.id === projectId);
      if (!target) return;

      try {
        const meta = await extractVideoMetadataAndThumbnail(file);
        const blobId = target.mediaBlobId || `media_${Date.now()}`;
        await saveMediaBlob(blobId, file, file.name);
        const updatedProj: ClipProject = {
          ...target,
          mediaBlobId: blobId,
          mediaName: file.name,
          thumbnailDataUrl: target.thumbnailDataUrl || meta.thumbnailDataUrl,
          updatedAt: new Date().toISOString(),
        };
        await saveProject(updatedProj).catch(() => {});
        if (authSession?.user?.id) {
          void upsertCloudProject(authSession.user.id, updatedProj);
        }
        setProjects((prev) => prev.map((p) => (p.id === updatedProj.id ? updatedProj : p)));
        setMediaRefreshTick((t) => t + 1);
        notify('Video re-vinculado al proyecto');
      } catch (err) {
        notify(
          err instanceof Error ? err.message : 'No se pudo re-vincular el video seleccionado'
        );
      }
    },
    [authSession?.user?.id, notify, projects]
  );

  const handleOpenEditor = useCallback(
    (projectId: string, clipId?: string) => {
      const proj = projects.find((p) => p.id === projectId);
      setActiveProjectId(projectId);
      setActiveClipId(clipId || proj?.clips[0]?.id || null);
      setActiveView('editor');
    },
    [projects]
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      await deleteProject(projectId).catch(() => {});
      if (authSession?.user?.id) {
        void deleteCloudProject(authSession.user.id, projectId);
      }
      setProjects((prev) => {
        const remaining = prev.filter((p) => p.id !== projectId);
        if (activeProjectId === projectId) {
          setActiveProjectId(remaining[0]?.id ?? null);
          setActiveClipId(remaining[0]?.clips[0]?.id ?? null);
        }
        return remaining;
      });
      setScheduledPosts((prev) => prev.filter((post) => post.projectId !== projectId));
      notify('Proyecto eliminado');
    },
    [activeProjectId, authSession?.user?.id, notify]
  );

  const handleRenameProject = useCallback(
    (projectId: string, title: string) => {
      setProjects((prev) =>
        prev.map((proj) => {
          if (proj.id !== projectId) return proj;
          const updated: ClipProject = {
            ...proj,
            title,
            updatedAt: new Date().toISOString(),
          };
          saveProject(updated).catch(() => {});
          if (authSession?.user?.id) {
            void upsertCloudProject(authSession.user.id, updated);
          }
          return updated;
        })
      );
      notify('Proyecto renombrado');
    },
    [authSession?.user?.id, notify]
  );

  const handleDuplicateProject = useCallback(
    async (projectId: string) => {
      const orig = projects.find((p) => p.id === projectId);
      if (!orig) return;
      const now = new Date().toISOString();
      const copy: ClipProject = {
        ...orig,
        id: `proj_${Date.now()}`,
        title: `${orig.title} (Copia)`,
        createdAt: now,
        updatedAt: now,
        clips: orig.clips.map((c, idx) => ({
          ...c,
          id: `clip_${Date.now()}_${idx}`,
          editorSettings: { ...c.editorSettings },
          subtitles: c.subtitles.map((s) => ({ ...s })),
        })),
      };
      await saveProject(copy).catch(() => {});
      if (authSession?.user?.id) {
        void upsertCloudProject(authSession.user.id, copy);
      }
      setProjects((prev) => [copy, ...prev]);
      notify('Proyecto duplicado');
    },
    [authSession?.user?.id, notify, projects]
  );

  const handleRenameClip = useCallback(
    (projectId: string, clipId: string, title: string) => {
      setProjects((prev) =>
        prev.map((proj) => {
          if (proj.id !== projectId) return proj;
          const updated: ClipProject = {
            ...proj,
            updatedAt: new Date().toISOString(),
            clips: proj.clips.map((c) => (c.id === clipId ? { ...c, title } : c)),
          };
          saveProject(updated).catch(() => {});
          if (authSession?.user?.id) {
            void upsertCloudProject(authSession.user.id, updated);
          }
          return updated;
        })
      );
      notify('Nombre del clip actualizado');
    },
    [authSession?.user?.id, notify]
  );

  const handleSaveClipEdits = useCallback(
    (
      projectId: string,
      clipId: string,
      nextSettings: EditorSettings,
      nextSubtitles: SubtitleCue[]
    ) => {
      setProjects((prev) =>
        prev.map((proj) => {
          if (proj.id !== projectId) return proj;
          const updatedProj: ClipProject = {
            ...proj,
            updatedAt: new Date().toISOString(),
            clips: proj.clips.map((c) => {
              if (c.id !== clipId) return c;
              return {
                ...c,
                start: nextSettings.trimStart,
                end: nextSettings.trimEnd,
                duration: Number(
                  Math.max(0.3, nextSettings.trimEnd - nextSettings.trimStart).toFixed(1)
                ),
                editorSettings: nextSettings,
                subtitles: nextSubtitles,
                transcriptSnippet:
                  nextSubtitles.map((s) => s.text.replace(/\*/g, '')).join(' ') ||
                  c.transcriptSnippet,
              };
            }),
          };
          saveProject(updatedProj).catch(() => {});
          if (authSession?.user?.id) {
            void upsertCloudProject(authSession.user.id, updatedProj);
          }
          return updatedProj;
        })
      );
    },
    [authSession?.user?.id]
  );

  const handleScheduleClip = useCallback((projectId: string, clipId: string) => {
    setSchedulerTarget({ projectId, clipId });
    setActiveView('scheduler');
  }, []);

  const handleCreatePost = useCallback(
    async (post: ScheduledPost) => {
      await saveScheduledPost(post).catch(() => {});
      if (authSession?.user?.id) {
        void upsertCloudScheduledPost(authSession.user.id, post);
      }
      setScheduledPosts((prev) =>
        [...prev, post].sort(
          (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        )
      );
    },
    [authSession?.user?.id]
  );

  const handleUpdatePostStatus = useCallback(
    async (id: string, status: ScheduledPost['status']) => {
      setScheduledPosts((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const updated = { ...p, status };
          saveScheduledPost(updated).catch(() => {});
          if (authSession?.user?.id) {
            void upsertCloudScheduledPost(authSession.user.id, updated);
          }
          return updated;
        })
      );
    },
    [authSession?.user?.id]
  );

  const handleDeletePost = useCallback(
    async (id: string) => {
      await deleteScheduledPost(id).catch(() => {});
      if (authSession?.user?.id) {
        void deleteCloudScheduledPost(authSession.user.id, id);
      }
      setScheduledPosts((prev) => prev.filter((p) => p.id !== id));
      notify('Publicación eliminada');
    },
    [authSession?.user?.id, notify]
  );

  const handleUpdateAppSettings = useCallback(
    (next: AppSettings) => {
      setAppSettings(next);
      setProjectConfig(buildConfigFromSettings(next));
      saveAppSettings(next).catch(() => {});
      if (authSession?.user?.id) {
        void upsertCloudAppSettings(authSession.user.id, next);
      }
      notify('Ajustes guardados localmente');
    },
    [authSession?.user?.id, notify]
  );

  const handleClearAllData = useCallback(async () => {
    await clearAllStudioData().catch(() => {});
    setProjects([]);
    setScheduledPosts([]);
    setActiveProjectId(null);
    setActiveClipId(null);
    setStagedMedia(null);
    setActiveView('create');
    notify('Todos los proyectos locales han sido eliminados');
  }, [notify]);

  if (authLoading) {
    return (
      <div className="h-screen w-screen bg-[#0b0d11] text-slate-300 flex items-center justify-center text-xs">
        Verificando sesión...
      </div>
    );
  }

  if (!authSession) {
    return (
      <div className="min-h-screen w-screen flex flex-col bg-[#0b0d11]">
        <UpdateBanner
          updateState={desktopUpdateState}
          onDownload={handleDownloadUpdate}
          onInstall={handleInstallUpdate}
          onOpenRelease={handleOpenReleasePage}
        />
        <div className="flex-1 flex flex-col">
          <LoginScreen />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0b0d11] text-slate-100">
      <UpdateBanner
        updateState={desktopUpdateState}
        onDownload={handleDownloadUpdate}
        onInstall={handleInstallUpdate}
        onOpenRelease={handleOpenReleasePage}
      />
      <TopNav
        activeView={activeView}
        onNavigate={setActiveView}
        projectsCount={projects.length}
        hasActiveProject={Boolean(activeProject)}
        scheduledCount={scheduledPosts.length}
        onNewProject={() => setActiveView('create')}
        onExportFromHeader={() => editorRef.current?.triggerExport()}
        isExporting={editorExportState.isExporting}
        canExport={editorExportState.canExport}
        userEmail={authSession.user.email ?? null}
        onSignOut={handleSignOut}
      />

      {activeView === 'create' && (
        <CreatePage
          stagedMedia={stagedMedia}
          config={projectConfig}
          appSettings={appSettings}
          analyzing={analyzing}
          analysisProgress={analysisProgress}
          analysisStep={analysisStep}
          errorMsg={createError}
          connectorStatus={connectorStatus}
          urlStatusText={urlStatusText}
          urlProgressPercent={urlProgressPercent}
          onSelectFile={handleSelectFile}
          onOpenRecorder={() => setRecordModalOpen(true)}
          onImportUrl={handleImportUrl}
          onCancelImportUrl={handleCancelImportUrl}
          onDownloadConnectorLauncher={handleDownloadLauncher}
          onSaveStagedToPc={handleSaveStagedToPc}
          onUpdateConfig={handleUpdateConfig}
          onChangeAiEngine={handleChangeAiEngine}
          onAnalyze={handleAnalyze}
          onStartManualClips={handleStartManualClips}
          onRunDemoProject={handleRunDemoProject}
        />
      )}

      {activeView === 'projects' && (
        <ProjectsPage
          projects={projects}
          onOpenResults={handleOpenResults}
          onOpenEditor={handleOpenEditor}
          onRenameProject={handleRenameProject}
          onDuplicateProject={handleDuplicateProject}
          onDeleteProject={handleDeleteProject}
          onNewProject={() => setActiveView('create')}
        />
      )}

      {activeView === 'results' && (
        <ResultsPage
          project={activeProject}
          mediaUrl={activeMediaUrl}
          retranscribing={retranscribing}
          retranscribeStatus={retranscribeStatus}
          onRetranscribeProject={handleRetranscribeProject}
          onOpenManualClipModal={handleOpenManualClipModal}
          onRelinkMedia={handleRelinkProjectMedia}
          onRenameClip={handleRenameClip}
          onDeleteClip={handleDeleteClip}
          onEditClipInStudio={handleOpenEditor}
          onScheduleClip={handleScheduleClip}
          onBackToProjects={() => setActiveView('projects')}
        />
      )}

      {activeView === 'editor' && (
        <ClipEditorWorkspace
          ref={editorRef}
          activeProject={activeProject}
          activeClipId={activeClipId}
          mediaUrl={activeMediaUrl}
          whisperModel={appSettings.whisperModel}
          onSelectClip={(cid) => setActiveClipId(cid)}
          onOpenManualClipModal={handleOpenManualClipModal}
          onRelinkMedia={handleRelinkProjectMedia}
          onSaveClipEdits={handleSaveClipEdits}
          onBackToResults={() => setActiveView(activeProject ? 'results' : 'projects')}
          onNotify={notify}
          onExportStateChange={setEditorExportState}
        />
      )}

      {activeView === 'scheduler' && (
        <SchedulerPage
          key={`${schedulerTarget?.projectId || 'none'}-${schedulerTarget?.clipId || 'none'}`}
          projects={projects}
          posts={scheduledPosts}
          initialProjectId={schedulerTarget?.projectId || activeProjectId}
          initialClipId={schedulerTarget?.clipId || activeClipId}
          onCreatePost={handleCreatePost}
          onUpdatePostStatus={handleUpdatePostStatus}
          onDeletePost={handleDeletePost}
          onOpenClipInEditor={handleOpenEditor}
          onNotify={notify}
        />
      )}

      {activeView === 'settings' && (
        <SettingsPage
          settings={appSettings}
          projectsCount={projects.length}
          userEmail={authSession.user.email ?? null}
          cloudSyncStatus={cloudSyncStatus}
          cloudSyncDetail={cloudSyncDetail}
          onSignOut={handleSignOut}
          desktopUpdateState={desktopUpdateState}
          onCheckForUpdates={handleCheckForUpdates}
          onDownloadUpdate={handleDownloadUpdate}
          onInstallUpdate={handleInstallUpdate}
          onOpenReleasePage={handleOpenReleasePage}
          onUpdateSettings={handleUpdateAppSettings}
          onClearAllData={handleClearAllData}
        />
      )}

      <RecordModal
        open={recordModalOpen}
        onClose={() => setRecordModalOpen(false)}
        onSaveRecording={(file) => {
          handleSelectFile(file);
          setActiveView('create');
        }}
      />

      <ManualClipModal
        open={Boolean(manualClipProjectId)}
        project={projects.find((p) => p.id === manualClipProjectId) || null}
        mediaUrl={manualClipProjectId === activeProjectId ? activeMediaUrl : null}
        creating={manualCreating}
        progressPercent={manualProgressPct}
        progressLabel={manualProgressLabel}
        errorMsg={manualModalError}
        onClose={() => {
          if (!manualCreating) {
            setManualClipProjectId(null);
            setManualModalError('');
          }
        }}
        onCreateClip={handleCreateManualClip}
      />

      <YouTubeImportModal
        info={ytBlockedInfo}
        connectorToken={connectorToken}
        connectorStatus={connectorStatus}
        downloading={connectorDownloading}
        progressPercent={connectorProgressPercent}
        progressLabel={connectorProgressLabel}
        errorMsg={connectorModalError}
        onClose={() => {
          setYtBlockedInfo(null);
          setConnectorModalError('');
        }}
        onConnectorStatusChange={setConnectorStatus}
        onDownloadLauncher={handleDownloadLauncher}
        onDownloadViaConnector={handleDownloadBlockedWithConnector}
        onPickLocalFile={() => quickFileInputRef.current?.click()}
      />

      <input
        ref={quickFileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleSelectFile(file);
          e.target.value = '';
        }}
      />

      <footer className="h-7 shrink-0 bg-[#0d1016] border-t border-slate-800/80 px-4 flex items-center justify-between text-[11px] text-slate-500">
        <span>
          KellyClipAi Studio · Desarrollado por{' '}
          <span className="text-slate-300 font-medium">Kelly Benjamin De La Cruz</span>
        </span>
        <span className="hidden sm:inline">
          {authSession.user.email ? `Cuenta: ${authSession.user.email}` : 'Sesión Supabase activa'}
        </span>
      </footer>

      {toastMsg && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-[#1a1e28] border border-slate-700 text-slate-100 px-4 py-2 rounded-lg text-xs font-medium shadow-xl z-50 pointer-events-none">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
