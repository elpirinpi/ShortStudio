import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { ArrowLeft, Film, FileText, FolderOpen, Music, Plus, Redo2, Undo2 } from 'lucide-react';
import {
  AudioProfile,
  ClipProject,
  DEFAULT_SETTINGS,
  DEFAULT_SUBTITLES,
  EditorSettings,
  FaceKeyframe,
  getCanvasDimensions,
  LeftTab,
  SafeZoneMode,
  SpeechSegment,
  SubtitleCue,
  TranscriptSegment,
  WhisperModelId,
} from '../types/editor';
import {
  analyzeAudioCleanupOnServer,
  buildSpeechSegmentsFromSilences,
  detectFillerMarks,
  subtractCutsFromSegments,
} from '../utils/audioCleanup';
import { getOrExtractAudioProfile } from '../utils/audioProfile';
import { computeTrackedPlacement, renderEditorFrame } from '../utils/canvasRenderer';
import {
  computeSpeechSegmentsFromEnergy,
  getEffectiveOutputDuration,
  getEffectiveSpeechSegments,
  sourceTimeToOutputTime,
} from '../utils/clipTiming';
import {
  createDemoFaceKeyframes,
  smoothFaceKeyframes,
  trackFacesInVideo,
} from '../utils/faceTracker';
import { transcribeVideoRange } from '../utils/localAi';
import {
  computeFinishSfxTimes,
  computeFinishZoomMoments,
} from '../utils/finishClip';
import {
  exportClipOffline,
  exportClipWithFfmpeg,
  transcodeVideoViaMediaJob,
} from '../utils/offlineExporter';
import { exportSubtitlesToSRT, formatTime, parseSRT, splitScriptToSubtitles } from '../utils/srt';
import { LeftSidebar } from './LeftSidebar';
import { ExportFormatOption, ExportModal, ExportOptionsModal, ScriptModal } from './Modals';
import { PreviewStage } from './PreviewStage';
import { RightSidebar } from './RightSidebar';
import { Timeline } from './Timeline';

export interface ClipEditorHandle {
  triggerExport: () => void;
}

interface ClipEditorWorkspaceProps {
  activeProject: ClipProject | null;
  activeClipId: string | null;
  mediaUrl: string | null;
  whisperModel: WhisperModelId;
  onSelectClip: (clipId: string) => void;
  onOpenManualClipModal?: (projectId: string) => void;
  onRelinkMedia?: (projectId: string, file: File) => void;
  onSaveClipEdits: (
    projectId: string,
    clipId: string,
    settings: EditorSettings,
    subtitles: SubtitleCue[]
  ) => void;
  onBackToResults: () => void;
  onNotify: (msg: string) => void;
  onExportStateChange: (state: { isExporting: boolean; canExport: boolean }) => void;
}

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export const ClipEditorWorkspace = forwardRef<ClipEditorHandle, ClipEditorWorkspaceProps>(
  function ClipEditorWorkspace(
    {
      activeProject,
      activeClipId,
      mediaUrl,
      whisperModel,
      onSelectClip,
      onOpenManualClipModal,
      onRelinkMedia,
      onSaveClipEdits,
      onBackToResults,
      onNotify,
      onExportStateChange,
    },
    ref
  ) {
    const [activeTab, setActiveTab] = useState<LeftTab>('subs');
    const [safeZone, setSafeZone] = useState<SafeZoneMode>('none');
    const [showFaceGuide, setShowFaceGuide] = useState(true);
    const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
    const [subtitles, setSubtitles] = useState<SubtitleCue[]>(DEFAULT_SUBTITLES);
    const [selectedSubId, setSelectedSubId] = useState<number | null>(
      DEFAULT_SUBTITLES[0]?.id ?? null
    );

    const [hasMedia, setHasMedia] = useState(false);
    const [isDemo, setIsDemo] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [loop, setLoop] = useState(true);
    const [duration, setDuration] = useState(12);
    const [currentTime, setCurrentTime] = useState(0);

    const [hasBgm, setHasBgm] = useState(false);
    const [bgmName, setBgmName] = useState('');

    const [trackingFaces, setTrackingFaces] = useState(false);
    const [faceTrackProgress, setFaceTrackProgress] = useState(0);
    const [faceTrackStatus, setFaceTrackStatus] = useState('');

    const [transcribing, setTranscribing] = useState(false);
    const [transcribeProgress, setTranscribeProgress] = useState(0);
    const [transcribeStatus, setTranscribeStatus] = useState('');

    const [isExporting, setIsExporting] = useState(false);
    const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState<ExportFormatOption>('mp4-h264');
    const [exportProgress, setExportProgress] = useState(0);
    const [exportStatus, setExportStatus] = useState(
      'Preparando renderizado con mezcla de audio...'
    );
    const [scriptModalOpen, setScriptModalOpen] = useState(false);
    const [audioProfile, setAudioProfile] = useState<AudioProfile | null>(null);
    const [waveformLoading, setWaveformLoading] = useState(false);
    const audioProfileRef = useRef<AudioProfile | null>(null);
    audioProfileRef.current = audioProfile;
    // N3: última transcripción con palabras (para detectar muletillas)
    const [cleanupAnalyzing, setCleanupAnalyzing] = useState(false);
    const lastTranscriptRef = useRef<TranscriptSegment[]>([]);

    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    const undoStackRef = useRef<Array<{ settings: EditorSettings; subtitles: SubtitleCue[] }>>([]);
    const redoStackRef = useRef<Array<{ settings: EditorSettings; subtitles: SubtitleCue[] }>>([]);
    const lastCommittedRef = useRef<{ settings: EditorSettings; subtitles: SubtitleCue[] } | null>(
      null
    );
    const isRestoringHistoryRef = useRef(false);
    const historyTimerRef = useRef<number | null>(null);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const bgmRef = useRef<HTMLAudioElement | null>(null);
    const videoInputRef = useRef<HTMLInputElement | null>(null);
    const relinkInputRef = useRef<HTMLInputElement | null>(null);
    const bgmInputRef = useRef<HTMLInputElement | null>(null);
    const srtInputRef = useRef<HTMLInputElement | null>(null);

    const blurCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const blurCtxRef = useRef<CanvasRenderingContext2D | null>(null);

    const settingsRef = useRef(settings);
    const subtitlesRef = useRef(subtitles);
    const hasMediaRef = useRef(hasMedia);
    const isDemoRef = useRef(isDemo);
    const isPlayingRef = useRef(isPlaying);
    const loopRef = useRef(loop);
    const durationRef = useRef(duration);
    const hasBgmRef = useRef(hasBgm);
    const isExportingRef = useRef(isExporting);
    const demoTimeRef = useRef(0);
    const lastFrameTsRef = useRef(0);
    const standaloneUrlRef = useRef<string | null>(null);
    const standaloneFileRef = useRef<File | null>(null);
    const rawFaceKeyframesRef = useRef<FaceKeyframe[]>([]);
    const bgmUrlRef = useRef<string | null>(null);
    const bgmFileRef = useRef<File | null>(null);

    const audioCtxRef = useRef<AudioContext | null>(null);
    const videoGainRef = useRef<GainNode | null>(null);
    const bgmGainRef = useRef<GainNode | null>(null);
    const speakerGainRef = useRef<GainNode | null>(null);
    const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const exportWatchdogRef = useRef<number | null>(null);
    const exportCanceledRef = useRef(false);
    const exportSignalRef = useRef<{ canceled: boolean }>({ canceled: false });
    const lastDrawnVideoTimeRef = useRef<number>(-1);
    const lastUiTimeUpdateRef = useRef<number>(0);

    const boundProjectSrcRef = useRef<string | null>(null);
    const pendingClipSeekRef = useRef<number | null>(null);
    const resetTrimOnLoadRef = useRef(false);
    const hydratedKeyRef = useRef<string | null>(null);
    const skipNextAutosaveRef = useRef(false);
    const autosaveTimerRef = useRef<number | null>(null);

    settingsRef.current = settings;
    subtitlesRef.current = subtitles;
    hasMediaRef.current = hasMedia;
    isDemoRef.current = isDemo;
    isPlayingRef.current = isPlaying;
    loopRef.current = loop;
    durationRef.current = duration;
    hasBgmRef.current = hasBgm;
    isExportingRef.current = isExporting;

    const currentClip =
      activeProject?.clips.find((c) => c.id === activeClipId) || activeProject?.clips[0] || null;

    useEffect(() => {
      onExportStateChange({ isExporting, canExport: hasMedia || isDemo });
    }, [isExporting, hasMedia, isDemo, onExportStateChange]);

    const getBlurResources = useCallback(() => {
      if (!blurCanvasRef.current) {
        const bc = document.createElement('canvas');
        bc.width = 135;
        bc.height = 240;
        blurCanvasRef.current = bc;
        blurCtxRef.current = bc.getContext('2d', { alpha: false });
      }
      return {
        blurCanvas: blurCanvasRef.current,
        blurCtx: blurCtxRef.current,
      };
    }, []);

    const drawCurrentFrame = useCallback(
      (explicitTime?: number) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { alpha: false });
        const { blurCanvas, blurCtx } = getBlurResources();
        if (!ctx || !blurCtx) return;

        const t =
          explicitTime !== undefined
            ? explicitTime
            : isDemoRef.current
            ? demoTimeRef.current
            : videoRef.current?.currentTime || 0;

        renderEditorFrame({
          ctx,
          blurCanvas,
          blurCtx,
          video: videoRef.current,
          hasMedia: hasMediaRef.current,
          isDemo: isDemoRef.current,
          currentTime: t,
          settings: settingsRef.current,
          subtitles: subtitlesRef.current,
        });
      },
      [getBlurResources]
    );

    const applyAudioVolumes = useCallback((volVideo: number, volBgm: number, bgmActive: boolean) => {
      const audioCtx = audioCtxRef.current;
      if (!audioCtx) return;
      const now = audioCtx.currentTime;
      if (videoGainRef.current) {
        videoGainRef.current.gain.setTargetAtTime(volVideo / 100, now, 0.02);
      }
      if (bgmGainRef.current) {
        bgmGainRef.current.gain.setTargetAtTime(bgmActive ? volBgm / 100 : 0, now, 0.02);
      }
    }, []);

    const initAudio = useCallback(() => {
      if (audioCtxRef.current) {
        if (audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {});
        }
        return;
      }

      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      audioCtxRef.current = audioCtx;

      const masterGain = audioCtx.createGain();
      const speakerGain = audioCtx.createGain();
      const audioDest = audioCtx.createMediaStreamDestination();
      speakerGainRef.current = speakerGain;
      audioDestRef.current = audioDest;

      const videoGain = audioCtx.createGain();
      const bgmGain = audioCtx.createGain();
      videoGainRef.current = videoGain;
      bgmGainRef.current = bgmGain;

      if (videoRef.current) {
        try {
          const videoSource = audioCtx.createMediaElementSource(videoRef.current);
          videoSource.connect(videoGain);
          videoGain.connect(masterGain);
        } catch {
          // Already connected
        }
      }

      if (bgmRef.current) {
        try {
          const bgmSource = audioCtx.createMediaElementSource(bgmRef.current);
          bgmSource.connect(bgmGain);
          bgmGain.connect(masterGain);
        } catch {
          // Already connected
        }
      }

      masterGain.connect(speakerGain);
      speakerGain.connect(audioCtx.destination);
      masterGain.connect(audioDest);

      applyAudioVolumes(settingsRef.current.volVideo, settingsRef.current.volBgm, hasBgmRef.current);
    }, [applyAudioVolumes]);

    const getCurrentPlayTime = useCallback(() => {
      return isDemoRef.current ? demoTimeRef.current : videoRef.current?.currentTime || 0;
    }, []);

    const seekTo = useCallback(
      (time: number) => {
        const clamped = Math.max(0, Math.min(durationRef.current, time));
        if (isDemoRef.current) {
          demoTimeRef.current = clamped;
          setCurrentTime(clamped);
          drawCurrentFrame(clamped);
        } else if (hasMediaRef.current && videoRef.current) {
          videoRef.current.currentTime = clamped;
          if (hasBgmRef.current && bgmRef.current && bgmRef.current.duration) {
            bgmRef.current.currentTime =
              Math.max(0, clamped - settingsRef.current.trimStart) % bgmRef.current.duration;
          }
          setCurrentTime(clamped);
        }
      },
      [drawCurrentFrame]
    );

    const togglePlay = useCallback(
      (forceState?: boolean) => {
        if (!hasMediaRef.current && !isDemoRef.current) {
          onNotify('Sube un video o prueba el Clip Demo primero');
          return;
        }
        initAudio();
        const shouldPlay = forceState !== undefined ? forceState : !isPlayingRef.current;
        isPlayingRef.current = shouldPlay;
        setIsPlaying(shouldPlay);

        if (shouldPlay) {
          const cur = getCurrentPlayTime();
          if (cur < settingsRef.current.trimStart || cur >= settingsRef.current.trimEnd - 0.05) {
            seekTo(settingsRef.current.trimStart);
          }
          if (!isDemoRef.current && videoRef.current) {
            videoRef.current.playbackRate = settingsRef.current.speed;
            videoRef.current.play().catch(() => {});
          }
          if (hasBgmRef.current && bgmRef.current) {
            bgmRef.current.play().catch(() => {});
          }
        } else {
          if (!isDemoRef.current && videoRef.current) {
            videoRef.current.pause();
          }
          if (bgmRef.current) {
            bgmRef.current.pause();
          }
        }
      },
      [getCurrentPlayTime, initAudio, onNotify, seekTo]
    );

    // Hydrate editor state when activeProject or activeClipId changes
    useEffect(() => {
      if (!activeProject || !currentClip) {
        hydratedKeyRef.current = null;
        return;
      }

      const key = `${activeProject.id}:${currentClip.id}`;
      if (hydratedKeyRef.current === key && boundProjectSrcRef.current === mediaUrl) {
        return;
      }

      hydratedKeyRef.current = key;
      skipNextAutosaveRef.current = true;
      togglePlay(false);

      const nextSettings: EditorSettings = {
        ...DEFAULT_SETTINGS,
        ...currentClip.editorSettings,
      };
      const nextSubs = currentClip.subtitles.map((s) => ({ ...s }));
      rawFaceKeyframesRef.current = nextSettings.faceKeyframes || [];

      setSettings(nextSettings);
      settingsRef.current = nextSettings;
      setSubtitles(nextSubs);
      subtitlesRef.current = nextSubs;
      setSelectedSubId(nextSubs[0]?.id ?? null);

      const projDuration = Math.max(1, activeProject.duration || nextSettings.trimEnd || 12);
      setDuration(projDuration);
      durationRef.current = projDuration;

      if (activeProject.isDemo) {
        setIsDemo(true);
        setHasMedia(false);
        isDemoRef.current = true;
        hasMediaRef.current = false;
        boundProjectSrcRef.current = null;
        demoTimeRef.current = nextSettings.trimStart;
        setCurrentTime(nextSettings.trimStart);
        window.requestAnimationFrame(() => drawCurrentFrame(nextSettings.trimStart));
      } else if (mediaUrl && videoRef.current) {
        setIsDemo(false);
        setHasMedia(true);
        isDemoRef.current = false;
        hasMediaRef.current = true;

        if (boundProjectSrcRef.current !== mediaUrl) {
          boundProjectSrcRef.current = mediaUrl;
          resetTrimOnLoadRef.current = false;
          pendingClipSeekRef.current = nextSettings.trimStart;
          videoRef.current.src = mediaUrl;
          videoRef.current.load();
        } else {
          videoRef.current.currentTime = nextSettings.trimStart;
          setCurrentTime(nextSettings.trimStart);
          window.requestAnimationFrame(() => drawCurrentFrame(nextSettings.trimStart));
        }
      } else {
        setIsDemo(false);
        setHasMedia(false);
        isDemoRef.current = false;
        hasMediaRef.current = false;
        boundProjectSrcRef.current = null;
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.removeAttribute('src');
        }
        setCurrentTime(nextSettings.trimStart);
        window.requestAnimationFrame(() => drawCurrentFrame(nextSettings.trimStart));
      }
    }, [activeProject, currentClip, mediaUrl, drawCurrentFrame, togglePlay]);

    const activeProjectIdRef = useRef<string | null>(activeProject?.id ?? null);
    const currentClipIdRef = useRef<string | null>(currentClip?.id ?? null);
    const onSaveClipEditsRef = useRef(onSaveClipEdits);
    activeProjectIdRef.current = activeProject?.id ?? null;
    currentClipIdRef.current = currentClip?.id ?? null;
    onSaveClipEditsRef.current = onSaveClipEdits;

    // Debounced auto-save & Undo/Redo history snapshot
    useEffect(() => {
      if (isRestoringHistoryRef.current) {
        isRestoringHistoryRef.current = false;
      } else {
        if (!lastCommittedRef.current) {
          lastCommittedRef.current = {
            settings,
            subtitles: subtitles.map((s) => ({ ...s })),
          };
        } else {
          if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
          historyTimerRef.current = window.setTimeout(() => {
            if (lastCommittedRef.current) {
              undoStackRef.current = [...undoStackRef.current.slice(-24), lastCommittedRef.current];
              redoStackRef.current = [];
              setCanUndo(undoStackRef.current.length > 0);
              setCanRedo(false);
            }
            lastCommittedRef.current = {
              settings,
              subtitles: subtitles.map((s) => ({ ...s })),
            };
          }, 320);
        }
      }

      if (!activeProjectIdRef.current || !currentClipIdRef.current) return;
      if (skipNextAutosaveRef.current) {
        skipNextAutosaveRef.current = false;
        return;
      }

      const pid = activeProjectIdRef.current;
      const cid = currentClipIdRef.current;
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = window.setTimeout(() => {
        onSaveClipEditsRef.current(pid, cid, settings, subtitles);
      }, 450);

      return () => {
        if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
        if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
      };
    }, [settings, subtitles]);

    const handleUndo = useCallback(() => {
      const prev = undoStackRef.current.pop();
      if (!prev) return;
      redoStackRef.current = [
        ...redoStackRef.current,
        { settings: settingsRef.current, subtitles: subtitlesRef.current.map((s) => ({ ...s })) },
      ];
      isRestoringHistoryRef.current = true;
      lastCommittedRef.current = prev;
      setSettings(prev.settings);
      setSubtitles(prev.subtitles);
      setCanUndo(undoStackRef.current.length > 0);
      setCanRedo(true);
      onNotify('Cambio deshecho');
    }, [onNotify]);

    const handleRedo = useCallback(() => {
      const next = redoStackRef.current.pop();
      if (!next) return;
      undoStackRef.current = [
        ...undoStackRef.current,
        { settings: settingsRef.current, subtitles: subtitlesRef.current.map((s) => ({ ...s })) },
      ];
      isRestoringHistoryRef.current = true;
      lastCommittedRef.current = next;
      setSettings(next.settings);
      setSubtitles(next.subtitles);
      setCanUndo(true);
      setCanRedo(redoStackRef.current.length > 0);
      onNotify('Cambio rehecho');
    }, [onNotify]);

    // Preview render loop (throttled UI state + live jump-cut silence skipping)
    useEffect(() => {
      let rafId = 0;

      const tick = (now: number) => {
        if (!lastFrameTsRef.current) lastFrameTsRef.current = now;
        const dt = Math.min(0.1, (now - lastFrameTsRef.current) / 1000);
        lastFrameTsRef.current = now;

        if (isPlayingRef.current && !isExportingRef.current) {
          const s = settingsRef.current;
          const segments = getEffectiveSpeechSegments(s);
          const firstSegStart = segments[0]?.start ?? s.trimStart;
          const lastSegEnd = segments[segments.length - 1]?.end ?? s.trimEnd;

          const findNextJumpTarget = (curT: number): number | null => {
            if (!s.silenceCutEnabled || segments.length <= 1) return null;
            if (curT < segments[0].start - 0.04) return segments[0].start;
            for (let idx = 0; idx < segments.length - 1; idx++) {
              const curSeg = segments[idx];
              const nextSeg = segments[idx + 1];
              if (curT >= curSeg.end - 0.025 && curT < nextSeg.start - 0.02) {
                return nextSeg.start;
              }
            }
            return null;
          };

          if (isDemoRef.current) {
            demoTimeRef.current += dt * s.speed;
            const jumpTarget = findNextJumpTarget(demoTimeRef.current);
            if (jumpTarget !== null) {
              demoTimeRef.current = jumpTarget;
            }
            if (demoTimeRef.current >= lastSegEnd) {
              if (loopRef.current) {
                demoTimeRef.current = firstSegStart;
                if (hasBgmRef.current && bgmRef.current?.duration) {
                  bgmRef.current.currentTime = 0;
                }
              } else {
                demoTimeRef.current = lastSegEnd;
                togglePlay(false);
              }
            }
            if (now - lastUiTimeUpdateRef.current >= 40 || !isPlayingRef.current) {
              lastUiTimeUpdateRef.current = now;
              setCurrentTime(demoTimeRef.current);
            }
            drawCurrentFrame(demoTimeRef.current);
          } else if (hasMediaRef.current && videoRef.current) {
            const v = videoRef.current;
            const jumpTarget = findNextJumpTarget(v.currentTime);
            if (jumpTarget !== null && !v.seeking) {
              v.currentTime = jumpTarget;
            }
            if (v.currentTime >= lastSegEnd || v.ended) {
              if (loopRef.current) {
                v.currentTime = firstSegStart;
                if (hasBgmRef.current && bgmRef.current?.duration) {
                  bgmRef.current.currentTime = 0;
                }
                v.play().catch(() => {});
              } else {
                togglePlay(false);
              }
            } else if (hasBgmRef.current && bgmRef.current && bgmRef.current.duration) {
              const expectedBgm =
                sourceTimeToOutputTime(v.currentTime, segments, s.speed) %
                bgmRef.current.duration;
              if (Math.abs(bgmRef.current.currentTime - expectedBgm) > 0.35) {
                bgmRef.current.currentTime = expectedBgm;
              }
            }
            if (Math.abs(v.currentTime - lastDrawnVideoTimeRef.current) >= 0.001) {
              lastDrawnVideoTimeRef.current = v.currentTime;
              drawCurrentFrame(v.currentTime);
            }
            if (now - lastUiTimeUpdateRef.current >= 40 || !isPlayingRef.current) {
              lastUiTimeUpdateRef.current = now;
              setCurrentTime(v.currentTime);
            }
          }
        }

        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    }, [drawCurrentFrame, togglePlay]);

    useEffect(() => {
      if (!isPlaying && !isExporting) {
        drawCurrentFrame();
      }
    }, [settings, subtitles, hasMedia, isDemo, isPlaying, isExporting, drawCurrentFrame]);

    useEffect(() => {
      applyAudioVolumes(settings.volVideo, settings.volBgm, hasBgm);
      if (videoRef.current && !isDemo) {
        videoRef.current.playbackRate = settings.speed;
      }
    }, [settings.volVideo, settings.volBgm, settings.speed, hasBgm, isDemo, applyAudioVolumes]);

    useEffect(() => {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => drawCurrentFrame());
      }
    }, [drawCurrentFrame]);

    useEffect(() => {
      return () => {
        if (standaloneUrlRef.current) URL.revokeObjectURL(standaloneUrlRef.current);
        if (bgmUrlRef.current) URL.revokeObjectURL(bgmUrlRef.current);
        if (exportWatchdogRef.current) window.clearInterval(exportWatchdogRef.current);
        if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {});
        }
      };
    }, []);

    // Load & cache audio waveform profile asynchronously when source changes
    useEffect(() => {
      if (!hasMedia && !isDemo) {
        setAudioProfile(null);
        return;
      }

      let canceled = false;
      const source = standaloneFileRef.current || mediaUrl;
      setWaveformLoading(true);
      getOrExtractAudioProfile({
        mediaBlobId: activeProject?.mediaBlobId ?? null,
        source,
        durationHint: durationRef.current || 12,
        isDemo,
        numBins: 360,
      })
        .then((prof) => {
          if (!canceled) {
            setAudioProfile(prof);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!canceled) setWaveformLoading(false);
        });

      return () => {
        canceled = true;
      };
    }, [activeProject?.mediaBlobId, hasMedia, isDemo, mediaUrl]);

    const recomputeSilencesFromProfile = useCallback(
      (
        prof: AudioProfile,
        opts: {
          trimStart: number;
          trimEnd: number;
          thresholdDb?: number;
          minSilenceSec?: number;
          paddingSec?: number;
        }
      ) => {
        return computeSpeechSegmentsFromEnergy(
          prof.energy20Hz,
          prof.sampleRateHz,
          prof.durationSec || durationRef.current,
          opts.trimStart,
          opts.trimEnd,
          {
            thresholdDb: opts.thresholdDb ?? -34,
            minSilenceSec: opts.minSilenceSec ?? 0.45,
            paddingSec: opts.paddingSec ?? 0.09,
          }
        );
      },
      []
    );

    const handleDetectSilences = useCallback(async () => {
      if (!hasMediaRef.current && !isDemoRef.current) {
        onNotify('Carga un video o el Clip Demo primero');
        return;
      }
      let prof = audioProfileRef.current;
      if (!prof) {
        setWaveformLoading(true);
        try {
          prof = await getOrExtractAudioProfile({
            mediaBlobId: activeProject?.mediaBlobId ?? null,
            source: standaloneFileRef.current || mediaUrl,
            durationHint: durationRef.current || 12,
            isDemo: isDemoRef.current,
            numBins: 360,
          });
          setAudioProfile(prof);
        } finally {
          setWaveformLoading(false);
        }
      }
      if (!prof || prof.energy20Hz.length === 0) {
        onNotify('Este video no tiene pista de audio detectable');
        return;
      }

      const s = settingsRef.current;
      const segs = recomputeSilencesFromProfile(prof, {
        trimStart: s.trimStart,
        trimEnd: s.trimEnd,
        thresholdDb: s.silenceThresholdDb,
        minSilenceSec: s.silenceMinSec,
        paddingSec: s.silencePaddingSec,
      });

      const rawDur = Math.max(0.1, s.trimEnd - s.trimStart);
      const keptDur = segs.reduce((acc, seg) => acc + Math.max(0, seg.end - seg.start), 0);
      const saved = Math.max(0, rawDur - keptDur);

      setSettings((prev) => ({
        ...prev,
        silenceCutEnabled: true,
        speechSegments: segs,
      }));
      onNotify(
        saved >= 0.2
          ? `Silencios recortados: ${segs.length} bloques · -${saved.toFixed(1)}s ahorrados`
          : 'No se encontraron pausas largas en el rango actual'
      );
    }, [activeProject?.mediaBlobId, mediaUrl, onNotify, recomputeSilencesFromProfile]);

    // ---------- N3: Limpieza automática de audio en un clic ----------
    const getTranscriptForFillers = useCallback((): TranscriptSegment[] => {
      if (lastTranscriptRef.current.length > 0) return lastTranscriptRef.current;
      return activeProject?.transcript ?? [];
    }, [activeProject]);

    const handleDetectFillers = useCallback(() => {
      const s = settingsRef.current;
      const transcript = getTranscriptForFillers();
      if (!transcript || transcript.length === 0) {
        onNotify('Transcribe primero el audio para detectar muletillas');
        return;
      }
      const marks = detectFillerMarks(transcript, s.fillerWords ?? '');
      if (marks.length === 0) {
        onNotify('No se detectaron muletillas en la transcripción');
        setSettings((prev) => ({ ...prev, fillerMarks: [], fillerCutEnabled: false }));
        return;
      }
      setSettings((prev) => {
        const base =
          prev.fillerBaseSegments && prev.fillerBaseSegments.length > 0
            ? prev.fillerBaseSegments
            : prev.speechSegments && prev.speechSegments.length > 0
              ? prev.speechSegments
              : [{ start: prev.trimStart, end: prev.trimEnd }];
        const withCuts = subtractCutsFromSegments(
          base,
          marks.filter((m) => m.enabled)
        );
        return {
          ...prev,
          fillerMarks: marks,
          fillerBaseSegments: base,
          fillerCutEnabled: true,
          silenceCutEnabled: true,
          speechSegments: withCuts,
        };
      });
      onNotify(
        `${marks.length} muletillas sugeridas: revísalas en «Limpiar y apretar» y desactiva las que quieras conservar`
      );
    }, [getTranscriptForFillers, onNotify]);

    const handleToggleFillerMark = useCallback((index: number, enabled: boolean) => {
      setSettings((prev) => {
        const marks = (prev.fillerMarks ?? []).map((m, i) =>
          i === index ? { ...m, enabled } : m
        );
        const base =
          prev.fillerBaseSegments && prev.fillerBaseSegments.length > 0
            ? prev.fillerBaseSegments
            : prev.speechSegments;
        if (!base || base.length === 0) {
          return { ...prev, fillerMarks: marks };
        }
        return {
          ...prev,
          fillerMarks: marks,
          speechSegments: prev.fillerCutEnabled
            ? subtractCutsFromSegments(
                base,
                marks.filter((m) => m.enabled)
              )
            : base,
        };
      });
    }, []);

    const handleRunAudioCleanup = useCallback(async () => {
      if (!hasMediaRef.current && !isDemoRef.current) {
        onNotify('Carga un video o el Clip Demo primero');
        return;
      }
      const s = settingsRef.current;

      if (isDemoRef.current) {
        setSettings((prev) => ({
          ...prev,
          audioCleanupEnabled: true,
          audioNormalizeEnabled: true,
          audioDenoiseEnabled: true,
        }));
        onNotify(
          'Limpieza activada para el Demo: nivelación y reducción de ruido se aplicarán al exportar con FFmpeg'
        );
        return;
      }

      const source = standaloneFileRef.current || mediaUrl;
      if (!source) {
        onNotify('No se encontró el archivo del video');
        return;
      }

      setCleanupAnalyzing(true);
      try {
        // 1) Silencios con FFmpeg (silencedetect) + medición loudnorm en el servidor.
        let baseSegments: SpeechSegment[] | null = null;
        let measured = s.loudnormMeasured ?? null;
        const analysis = await analyzeAudioCleanupOnServer(source, {
          thresholdDb: s.silenceThresholdDb,
          minSilenceSec: s.silenceMinSec,
        });
        if (analysis) {
          baseSegments = buildSpeechSegmentsFromSilences(analysis.silences, s.trimStart, s.trimEnd, {
            minSilenceSec: s.silenceMinSec,
            keepSec: s.silencePaddingSec,
          });
          if (analysis.loudnorm) measured = analysis.loudnorm;
        }

        // 2) Respaldo: perfil de energía en el navegador (como «Detectar Silencios»).
        if (!baseSegments) {
          let prof = audioProfileRef.current;
          if (!prof) {
            setWaveformLoading(true);
            try {
              prof = await getOrExtractAudioProfile({
                mediaBlobId: activeProject?.mediaBlobId ?? null,
                source,
                durationHint: durationRef.current || 12,
                isDemo: false,
                numBins: 360,
              });
              setAudioProfile(prof);
            } finally {
              setWaveformLoading(false);
            }
          }
          if (prof && prof.energy20Hz.length > 0) {
            baseSegments = recomputeSilencesFromProfile(prof, {
              trimStart: s.trimStart,
              trimEnd: s.trimEnd,
              thresholdDb: s.silenceThresholdDb,
              minSilenceSec: s.silenceMinSec,
              paddingSec: s.silencePaddingSec,
            });
          }
        }

        if (!baseSegments || baseSegments.length === 0) {
          onNotify('Este video no tiene pista de audio detectable');
          return;
        }

        // 3) Muletillas sugeridas desde la transcripción (si la hay).
        const marks = detectFillerMarks(getTranscriptForFillers(), s.fillerWords ?? '');
        const finalSegments =
          marks.length > 0
            ? subtractCutsFromSegments(
                baseSegments,
                marks.filter((m) => m.enabled)
              )
            : baseSegments;

        const rawDur = Math.max(0.1, s.trimEnd - s.trimStart);
        const keptDur = finalSegments.reduce(
          (acc, seg) => acc + Math.max(0, seg.end - seg.start),
          0
        );
        const saved = Math.max(0, rawDur - keptDur);

        setSettings((prev) => ({
          ...prev,
          audioCleanupEnabled: true,
          audioNormalizeEnabled: true,
          audioDenoiseEnabled: true,
          loudnormMeasured: measured,
          silenceCutEnabled: true,
          speechSegments: finalSegments,
          fillerBaseSegments: baseSegments as SpeechSegment[],
          fillerMarks: marks,
          fillerCutEnabled: marks.length > 0,
        }));
        onNotify(
          `Limpieza lista: -${saved.toFixed(1)}s de silencios${
            marks.length > 0 ? ` · ${marks.length} muletillas sugeridas` : ''
          } · volumen nivelado al exportar`
        );
      } finally {
        setCleanupAnalyzing(false);
      }
    }, [
      activeProject?.mediaBlobId,
      getTranscriptForFillers,
      mediaUrl,
      onNotify,
      recomputeSilencesFromProfile,
    ]);

    const updateSetting = useCallback(
      <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
        setSettings((prev) => {
          const next = { ...prev, [key]: value };
          if (key === 'faceSmoothing' && rawFaceKeyframesRef.current.length > 0) {
            next.faceKeyframes = smoothFaceKeyframes(
              rawFaceKeyframesRef.current,
              value as number
            );
          }
          if (
            (key === 'silenceThresholdDb' ||
              key === 'silenceMinSec' ||
              key === 'silenceCutEnabled') &&
            next.silenceCutEnabled &&
            audioProfileRef.current &&
            audioProfileRef.current.energy20Hz.length > 0
          ) {
            next.speechSegments = recomputeSilencesFromProfile(audioProfileRef.current, {
              trimStart: next.trimStart,
              trimEnd: next.trimEnd,
              thresholdDb: next.silenceThresholdDb,
              minSilenceSec: next.silenceMinSec,
              paddingSec: next.silencePaddingSec,
            });
          }
          if (key === 'fillerCutEnabled') {
            const base =
              next.fillerBaseSegments && next.fillerBaseSegments.length > 0
                ? next.fillerBaseSegments
                : null;
            if (base) {
              next.speechSegments = value
                ? subtractCutsFromSegments(
                    base,
                    (next.fillerMarks ?? []).filter((m) => m.enabled)
                  )
                : base;
              if (value) next.silenceCutEnabled = true;
            }
          }
          return next;
        });
      },
      [recomputeSilencesFromProfile]
    );

    const applySubtitlePreset = useCallback((patch: Partial<EditorSettings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
    }, []);

    const handleRunFaceTracking = useCallback(async () => {
      if (trackingFaces) return;
      if (!hasMediaRef.current && !isDemoRef.current) {
        onNotify('Carga un video o el Clip Demo primero');
        return;
      }

      if (isDemoRef.current) {
        setTrackingFaces(true);
        setFaceTrackProgress(40);
        setFaceTrackStatus('Generando ruta de seguimiento en Clip Demo...');
        const raw = createDemoFaceKeyframes(settingsRef.current.trimStart, settingsRef.current.trimEnd);
        rawFaceKeyframesRef.current = raw;
        const smoothed = smoothFaceKeyframes(raw, settingsRef.current.faceSmoothing);
        setSettings((prev) => ({
          ...prev,
          faceTracking: true,
          faceKeyframes: smoothed,
          faceEngineUsed: 'Seguimiento Demo IA',
        }));
        setShowFaceGuide(true);
        setFaceTrackProgress(100);
        setTrackingFaces(false);
        onNotify('Seguimiento de rostro activado en Demo');
        return;
      }

      const source = standaloneFileRef.current || mediaUrl;
      if (!source) {
        onNotify('No se encontró la fuente de video para analizar rostros');
        return;
      }

      setTrackingFaces(true);
      setFaceTrackProgress(5);
      setFaceTrackStatus('Preparando detección facial...');

      try {
        const res = await trackFacesInVideo({
          source,
          start: settingsRef.current.trimStart,
          end: settingsRef.current.trimEnd,
          smoothing: settingsRef.current.faceSmoothing,
          sampleFps: 2.5,
          maxSamples: 55,
          onProgress: (pct, msg) => {
            setFaceTrackProgress(pct);
            setFaceTrackStatus(msg);
          },
        });
        rawFaceKeyframesRef.current = res.keyframes;
        setSettings((prev) => ({
          ...prev,
          faceTracking: true,
          faceKeyframes: res.keyframes,
          faceEngineUsed: res.engineUsed,
        }));
        setShowFaceGuide(true);
        onNotify(
          res.facesDetectedCount > 0
            ? `Rostro rastreado (${res.keyframes.length} puntos · ${res.engineUsed})`
            : 'Seguimiento aplicado con encuadre centrado'
        );
      } catch (err) {
        onNotify(
          err instanceof Error ? err.message : 'No se pudo completar el seguimiento de rostro'
        );
      } finally {
        setTrackingFaces(false);
      }
    }, [mediaUrl, onNotify, trackingFaces]);

    const handleClearFaceTracking = useCallback(() => {
      rawFaceKeyframesRef.current = [];
      setSettings((prev) => ({
        ...prev,
        faceTracking: false,
        faceKeyframes: [],
        faceEngineUsed: undefined,
      }));
      onNotify('Puntos de seguimiento eliminados');
    }, [onNotify]);

    const handleTranscribeAudio = useCallback(
      async (language: string, wordsPerBlock: number) => {
        if (transcribing) return;
        if (!hasMediaRef.current && !isDemoRef.current) {
          onNotify('Carga un video antes de transcribir');
          return;
        }

        if (isDemoRef.current) {
          const demoText =
            'LOS PRIMEROS *3 SEGUNDOS* DECIDEN SI TU *VIDEO* SE HACE *VIRAL* EDITA COMO UN *PRO* EN 9:16';
          const generated = splitScriptToSubtitles(
            demoText,
            wordsPerBlock,
            settingsRef.current.trimStart,
            settingsRef.current.trimEnd
          );
          if (generated.length > 0) {
            setSubtitles(generated);
            setSelectedSubId(generated[0].id);
            onNotify('Subtítulos del Demo re-sincronizados');
          }
          return;
        }

        const source = standaloneFileRef.current || mediaUrl;
        if (!source) {
          onNotify('No se encontró el audio del video');
          return;
        }

        setTranscribing(true);
        setTranscribeProgress(5);
        setTranscribeStatus('Preparando audio del clip...');

        try {
          const res = await transcribeVideoRange({
            source,
            start: settingsRef.current.trimStart,
            end: settingsRef.current.trimEnd,
            language,
            modelId: whisperModel,
            wordsPerBlock,
            onProgress: (pct, msg) => {
              setTranscribeProgress(pct);
              setTranscribeStatus(msg);
            },
          });
          if (res.subtitles.length > 0) {
            lastTranscriptRef.current = res.transcript ?? [];
            setSubtitles(res.subtitles);
            setSelectedSubId(res.subtitles[0].id);
            onNotify(`${res.subtitles.length} bloques generados (${res.engineUsed})`);
          } else {
            onNotify('No se detectó voz clara en el fragmento seleccionado');
          }
        } catch (err) {
          onNotify(err instanceof Error ? err.message : 'Error al transcribir audio');
        } finally {
          setTranscribing(false);
        }
      },
      [mediaUrl, onNotify, transcribing, whisperModel]
    );

    const handleTrimStartChange = (val: number) => {
      const next = Math.max(0, Math.min(settings.trimEnd - 0.3, val));
      updateSetting('trimStart', Number(next.toFixed(1)));
      seekTo(next);
    };

    const handleTrimEndChange = (val: number) => {
      const next = Math.max(settings.trimStart + 0.3, Math.min(duration, val));
      updateSetting('trimEnd', Number(next.toFixed(1)));
    };

    const handleSetIn = useCallback(() => {
      const cur = getCurrentPlayTime();
      if (cur < settingsRef.current.trimEnd - 0.3) {
        const next = Number(cur.toFixed(1));
        updateSetting('trimStart', next);
        onNotify(`Inicio fijado en ${formatTime(next)}`);
      }
    }, [getCurrentPlayTime, onNotify, updateSetting]);

    const handleSetOut = useCallback(() => {
      const cur = getCurrentPlayTime();
      if (cur > settingsRef.current.trimStart + 0.3) {
        const next = Number(cur.toFixed(1));
        updateSetting('trimEnd', next);
        onNotify(`Fin fijado en ${formatTime(next)}`);
      }
    }, [getCurrentPlayTime, onNotify, updateSetting]);

    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        const tag = (document.activeElement?.tagName || '').toUpperCase();
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
          e.preventDefault();
          handleRedo();
          return;
        }

        if (e.code === 'Space') {
          e.preventDefault();
          togglePlay();
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          seekTo(getCurrentPlayTime() - 0.5);
        } else if (e.code === 'ArrowRight') {
          e.preventDefault();
          seekTo(getCurrentPlayTime() + 0.5);
        } else if (e.key.toLowerCase() === 'i') {
          handleSetIn();
        } else if (e.key.toLowerCase() === 'o') {
          handleSetOut();
        }
      };

      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [getCurrentPlayTime, handleRedo, handleSetIn, handleSetOut, handleUndo, seekTo, togglePlay]);

    const loadStandaloneVideoFile = (file: File) => {
      if (!file.type.startsWith('video/')) {
        onNotify('Selecciona un archivo de video válido (MP4, MOV, WebM)');
        return;
      }
      togglePlay(false);
      if (standaloneUrlRef.current) URL.revokeObjectURL(standaloneUrlRef.current);
      const url = URL.createObjectURL(file);
      standaloneUrlRef.current = url;
      standaloneFileRef.current = file;
      boundProjectSrcRef.current = url;
      resetTrimOnLoadRef.current = true;
      pendingClipSeekRef.current = 0.01;
      rawFaceKeyframesRef.current = [];
      setSettings((prev) => ({
        ...prev,
        faceTracking: false,
        faceKeyframes: [],
        faceEngineUsed: undefined,
      }));

      setIsDemo(false);
      setHasMedia(true);
      isDemoRef.current = false;
      hasMediaRef.current = true;

      if (videoRef.current) {
        videoRef.current.src = url;
        videoRef.current.load();
      }
      onNotify(`Cargando ${file.name}`);
    };

    const handleVideoLoadedMetadata = () => {
      const v = videoRef.current;
      if (!v) return;
      const dur = v.duration || 10;
      setDuration(dur);
      durationRef.current = dur;

      if (resetTrimOnLoadRef.current) {
        resetTrimOnLoadRef.current = false;
        const roundedDur = Number(dur.toFixed(1));
        setSettings((prev) => ({
          ...prev,
          trimStart: 0,
          trimEnd: roundedDur,
        }));
      }

      const seekTarget =
        pendingClipSeekRef.current !== null ? pendingClipSeekRef.current : 0.01;
      pendingClipSeekRef.current = null;
      v.currentTime = Math.min(dur - 0.05, Math.max(0.01, seekTarget));
      setCurrentTime(seekTarget);
      onNotify('Video listo en ShortStudio');
    };

    const handleLoadDemo = () => {
      togglePlay(false);
      setIsDemo(true);
      setHasMedia(false);
      isDemoRef.current = true;
      hasMediaRef.current = false;

      setDuration(12);
      durationRef.current = 12;
      demoTimeRef.current = 0;
      setCurrentTime(0);
      setSettings((prev) => ({
        ...prev,
        trimStart: 0,
        trimEnd: 12,
      }));
      drawCurrentFrame(0);
      togglePlay(true);
      onNotify('Clip demo cargado');
    };

    const handleBgmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !bgmRef.current) return;
      if (bgmUrlRef.current) URL.revokeObjectURL(bgmUrlRef.current);
      const url = URL.createObjectURL(file);
      bgmUrlRef.current = url;
      bgmFileRef.current = file;
      bgmRef.current.src = url;
      bgmRef.current.load();
      setHasBgm(true);
      setBgmName(file.name);
      hasBgmRef.current = true;
      applyAudioVolumes(settings.volVideo, settings.volBgm, true);
      if (isPlayingRef.current) bgmRef.current.play().catch(() => {});
      onNotify('Música de fondo añadida');
      e.target.value = '';
    };

    const handleRemoveBgm = () => {
      if (bgmRef.current) {
        bgmRef.current.pause();
        bgmRef.current.removeAttribute('src');
      }
      if (bgmUrlRef.current) {
        URL.revokeObjectURL(bgmUrlRef.current);
        bgmUrlRef.current = null;
      }
      bgmFileRef.current = null;
      setHasBgm(false);
      setBgmName('');
      hasBgmRef.current = false;
      applyAudioVolumes(settings.volVideo, settings.volBgm, false);
    };

    const handleSrtChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = typeof ev.target?.result === 'string' ? ev.target.result : '';
        const parsed = parseSRT(content);
        if (parsed.length > 0) {
          setSubtitles(parsed);
          setSelectedSubId(parsed[0].id);
          onNotify(`${parsed.length} subtítulos importados`);
        } else {
          onNotify('No se detectaron subtítulos válidos en el .SRT');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    };

    const handleExportSrt = () => {
      if (subtitles.length === 0) return;
      const srtContent = exportSubtitlesToSRT(subtitles);
      const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ShortStudio_${Date.now()}.srt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 3000);
      onNotify('Subtítulos descargados en .SRT');
    };

    const handleAddSub = () => {
      const cur = getCurrentPlayTime();
      const start = Number(cur.toFixed(1));
      const end = Number(Math.min(duration, Math.max(start + 0.5, start + 2.0)).toFixed(1));
      const newCue: SubtitleCue = {
        id: Date.now(),
        start,
        end,
        text: 'NUEVO TEXTO *VIRAL*',
      };
      setSubtitles((prev) => [...prev, newCue].sort((a, b) => a.start - b.start));
      setSelectedSubId(newCue.id);
      onNotify('Bloque de subtítulo añadido');
    };

    const handleUpdateSub = (id: number, patch: Partial<SubtitleCue>) => {
      setSubtitles((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s)).sort((a, b) => a.start - b.start)
      );
    };

    const handleMoveSub = (id: number, start: number, end: number) => {
      setSubtitles((prev) => prev.map((s) => (s.id === id ? { ...s, start, end } : s)));
    };

    const handleSplitSub = (id: number) => {
      const cue = subtitles.find((s) => s.id === id);
      if (!cue || cue.end - cue.start < 0.6) return;

      const midTime = Number(((cue.start + cue.end) / 2).toFixed(2));
      const words = cue.text.trim().split(/\s+/);
      const splitAt = Math.max(1, Math.ceil(words.length / 2));
      const firstText = words.slice(0, splitAt).join(' ') || cue.text;
      const secondText = words.slice(splitAt).join(' ') || cue.text;

      const secondCue: SubtitleCue = {
        id: Date.now(),
        start: Number((midTime + 0.02).toFixed(2)),
        end: cue.end,
        text: secondText,
      };

      setSubtitles((prev) =>
        prev
          .map((s) => (s.id === id ? { ...s, end: midTime, text: firstText } : s))
          .concat(secondCue)
          .sort((a, b) => a.start - b.start)
      );
      onNotify('Bloque dividido en 2');
    };

    const handleMergeNextSub = (id: number) => {
      const sorted = [...subtitles].sort((a, b) => a.start - b.start);
      const idx = sorted.findIndex((s) => s.id === id);
      if (idx < 0 || idx >= sorted.length - 1) return;

      const current = sorted[idx];
      const next = sorted[idx + 1];
      const merged: SubtitleCue = {
        id: current.id,
        start: current.start,
        end: Math.max(current.end, next.end),
        text: `${current.text.trim()} ${next.text.trim()}`.trim(),
      };

      setSubtitles(
        sorted.filter((s) => s.id !== next.id).map((s) => (s.id === current.id ? merged : s))
      );
      onNotify('Bloques unidos');
    };

    const handleDeleteSub = (id: number) => {
      setSubtitles((prev) => prev.filter((s) => s.id !== id));
      setSelectedSubId((prev) => (prev === id ? null : prev));
    };

    const handleGenerateScript = (scriptText: string, wordsPerBlock: number) => {
      const generated = splitScriptToSubtitles(
        scriptText,
        wordsPerBlock,
        settings.trimStart,
        settings.trimEnd
      );
      if (generated.length > 0) {
        setSubtitles(generated);
        setSelectedSubId(generated[0].id);
        setScriptModalOpen(false);
        onNotify(`${generated.length} bloques generados`);
      }
    };

    const cleanupAfterExport = useCallback(() => {
      if (exportWatchdogRef.current) {
        window.clearInterval(exportWatchdogRef.current);
        exportWatchdogRef.current = null;
      }
      setIsExporting(false);
      isExportingRef.current = false;
      if (speakerGainRef.current && audioCtxRef.current) {
        speakerGainRef.current.gain.setValueAtTime(1, audioCtxRef.current.currentTime);
      }
      drawCurrentFrame();
    }, [drawCurrentFrame]);

    const finishExport = useCallback(() => {
      if (exportWatchdogRef.current) {
        window.clearInterval(exportWatchdogRef.current);
        exportWatchdogRef.current = null;
      }
      if (!isDemoRef.current && videoRef.current) videoRef.current.pause();
      if (hasBgmRef.current && bgmRef.current) bgmRef.current.pause();

      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== 'inactive') {
        mr.stop();
      } else {
        cleanupAfterExport();
      }
    }, [cleanupAfterExport]);

    const dims = getCanvasDimensions(settings.ratio);
    const dimsLabel = `${dims.width}×${dims.height}`;

    const startExport = useCallback(
      async (formatChoice: ExportFormatOption = exportFormat) => {
        if (!hasMediaRef.current && !isDemoRef.current) {
          onNotify('Carga un video o el Clip Demo antes de exportar');
          return;
        }
        if (isExportingRef.current) return;

        const downloadBlob = (blob: Blob, ext: string) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `KellyClipAi_${Date.now()}.${ext}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 5000);
        };

        setExportOptionsOpen(false);
        togglePlay(false);

        const currentDims = getCanvasDimensions(settingsRef.current.ratio);
        const resLabel = `${currentDims.width}×${currentDims.height}`;

        const signal = { canceled: false };
        exportSignalRef.current = signal;
        exportCanceledRef.current = false;
        setIsExporting(true);
        isExportingRef.current = true;
        setExportProgress(0);
        setExportStatus(`Preparando renderizado exacto ${resLabel} (30fps)...`);

        // N4 — «Terminar mi clip»: si está activo, los momentos de zoom y
        // los instantes de efecto se calculan sobre una COPIA de los
        // ajustes; el proyecto original no se modifica.
        const baseSettings = settingsRef.current;
        const exportSettings = baseSettings.finishClipEnabled
          ? {
              ...baseSettings,
              finishZoomMoments: computeFinishZoomMoments(
                baseSettings,
                subtitlesRef.current
              ),
              finishSfxTimes: computeFinishSfxTimes(baseSettings),
            }
          : baseSettings;

        // Ultra-fast native FFmpeg backend path (zero browser frame-by-frame decode/seek)
        if (formatChoice === 'ffmpeg-fast') {
          const ffmpegResult = await exportClipWithFfmpeg({
            source: standaloneFileRef.current || mediaUrl,
            mediaBlobId: standaloneFileRef.current ? null : activeProject?.mediaBlobId ?? null,
            isDemo: isDemoRef.current,
            bgmUrl: bgmUrlRef.current,
            bgmBlob: bgmFileRef.current,
            hasBgm: hasBgmRef.current,
            settings: exportSettings,
            subtitles: subtitlesRef.current,
            signal,
            onProgress: (pct, msg) => {
              setExportProgress(pct);
              setExportStatus(msg);
            },
          });

          if (ffmpegResult.ok) {
            downloadBlob(ffmpegResult.blob, 'mp4');
            onNotify('Short exportado ultra-rápido con FFmpeg (.MP4)');
            cleanupAfterExport();
            return;
          }

          if (ffmpegResult.canceled) {
            onNotify('Exportación cancelada');
            cleanupAfterExport();
            return;
          }
          // Fall through to WebCodecs offline MP4 if FFmpeg isn't applicable (e.g. Demo or watermark)
        }

        // Primary deterministic offline path for MP4 (0ms A/V & subtitle drift, locked 30.000 fps)
        if (formatChoice === 'mp4-h264' || formatChoice === 'ffmpeg-fast') {
          const offlineResult = await exportClipOffline({
            source: standaloneFileRef.current || mediaUrl,
            isDemo: isDemoRef.current,
            bgmUrl: bgmUrlRef.current,
            hasBgm: hasBgmRef.current,
            settings: settingsRef.current,
            subtitles: subtitlesRef.current,
            signal,
            onProgress: (pct, msg) => {
              setExportProgress(pct);
              setExportStatus(msg);
            },
          });

          if (offlineResult.ok) {
            downloadBlob(offlineResult.blob, 'mp4');
            onNotify('Short exportado en .MP4 Universal (30fps exacto y sincronizado)');
            cleanupAfterExport();
            return;
          }

          if (offlineResult.canceled) {
            onNotify('Exportación cancelada');
            cleanupAfterExport();
            return;
          }
          // Otherwise fall through gracefully to synchronized MediaRecorder + CFR FFmpeg transcode
        }

        // Fallback / WebM instant path: synchronized MediaRecorder
        const mimeType = getSupportedMimeType();
        if (!mimeType || !canvasRef.current) {
          onNotify('Tu navegador no soporta exportación de video. Usa Chrome o Edge.');
          cleanupAfterExport();
          return;
        }

        initAudio();
        setExportStatus(`Renderizando en ${resLabel} (30fps)... No minimices esta pestaña.`);

        if (speakerGainRef.current && audioCtxRef.current) {
          speakerGainRef.current.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
        }

        const canvasStream = canvasRef.current.captureStream(30);
        const audioTracks = audioDestRef.current ? audioDestRef.current.stream.getAudioTracks() : [];
        const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

        const chunks: BlobPart[] = [];
        const recorder = new MediaRecorder(combinedStream, {
          mimeType,
          videoBitsPerSecond: 5_000_000,
        });
        mediaRecorderRef.current = recorder;

        let rvfcId = 0;
        let demoRafId = 0;

        const stopSyncLoops = () => {
          if (demoRafId) {
            cancelAnimationFrame(demoRafId);
            demoRafId = 0;
          }
          const v = videoRef.current as
            | (HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void })
            | null;
          if (rvfcId && v && typeof v.cancelVideoFrameCallback === 'function') {
            v.cancelVideoFrameCallback(rvfcId);
            rvfcId = 0;
          }
        };

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
          stopSyncLoops();
          if (!exportCanceledRef.current && chunks.length > 0) {
            const rawExt = mimeType.includes('mp4') ? 'mp4' : 'webm';
            const rawBlob = new Blob(chunks, { type: mimeType });

            if (formatChoice === 'mp4-h264' || formatChoice === 'ffmpeg-fast') {
              setExportProgress(92);
              setExportStatus('Sincronizando y convirtiendo a MP4 Universal (30fps CFR)...');
              try {
                const mp4Blob = await transcodeVideoViaMediaJob(rawBlob);
                if (mp4Blob.size > 0) {
                  downloadBlob(mp4Blob, 'mp4');
                  onNotify('Short exportado en .MP4 Universal (H.264)');
                } else {
                  downloadBlob(rawBlob, rawExt);
                  onNotify(`Short exportado en .${rawExt.toUpperCase()}`);
                }
              } catch {
                downloadBlob(rawBlob, rawExt);
                onNotify(`Transcodificación omitida; descargado en .${rawExt.toUpperCase()}`);
              }
            } else {
              downloadBlob(rawBlob, rawExt);
              onNotify(`Short exportado en .${rawExt.toUpperCase()}`);
            }
          } else if (exportCanceledRef.current) {
            onNotify('Exportación cancelada');
          }
          cleanupAfterExport();
        };

        const s = settingsRef.current;
        const segDur = Math.max(0.1, s.trimEnd - s.trimStart);

        if (isDemoRef.current) {
          demoTimeRef.current = s.trimStart;
        } else if (videoRef.current) {
          videoRef.current.currentTime = s.trimStart;
          videoRef.current.playbackRate = s.speed;
        }
        if (hasBgmRef.current && bgmRef.current && bgmRef.current.duration) {
          bgmRef.current.currentTime = 0;
        }

        const startProgressWatchdog = () => {
          let lastTs = performance.now();
          exportWatchdogRef.current = window.setInterval(() => {
            if (!isExportingRef.current || exportCanceledRef.current) return;
            const now = performance.now();
            const dt = (now - lastTs) / 1000;
            lastTs = now;

            if (isDemoRef.current) {
              demoTimeRef.current += dt * settingsRef.current.speed;
            }

            const cur = getCurrentPlayTime();
            const elapsed = Math.max(0, cur - s.trimStart);
            const maxRenderPct =
              formatChoice === 'mp4-h264' || formatChoice === 'ffmpeg-fast' ? 90 : 99;
            const pct = Math.min(maxRenderPct, Math.max(0, (elapsed / segDur) * maxRenderPct));
            setExportProgress(pct);
            setExportStatus(
              `Renderizando ${resLabel} · ${pct.toFixed(0)}% (${formatTime(elapsed)} / ${formatTime(segDur)})`
            );

            if (cur >= s.trimEnd || (!isDemoRef.current && videoRef.current?.ended)) {
              setExportProgress(maxRenderPct);
              stopSyncLoops();
              finishExport();
            }
          }, 40);
        };

        const beginRecording = () => {
          if (exportCanceledRef.current) return;

          if (isDemoRef.current) {
            drawCurrentFrame(demoTimeRef.current);
            recorder.start(250);
            if (hasBgmRef.current && bgmRef.current) bgmRef.current.play().catch(() => {});
            const demoPump = () => {
              if (!isExportingRef.current || exportCanceledRef.current) return;
              drawCurrentFrame(demoTimeRef.current);
              demoRafId = requestAnimationFrame(demoPump);
            };
            demoRafId = requestAnimationFrame(demoPump);
            startProgressWatchdog();
            return;
          }

          const v = videoRef.current as HTMLVideoElement & {
            requestVideoFrameCallback?: (
              cb: (now: number, meta: { mediaTime?: number }) => void
            ) => number;
          };
          if (!v) return;

          let recorderStarted = false;
          const startRecorderOnce = () => {
            if (recorderStarted || exportCanceledRef.current) return;
            recorderStarted = true;
            recorder.start(250);
            startProgressWatchdog();
          };

          if (typeof v.requestVideoFrameCallback === 'function') {
            const onFrame = (_now: number, meta: { mediaTime?: number }) => {
              if (!isExportingRef.current || exportCanceledRef.current) return;
              drawCurrentFrame(meta.mediaTime ?? v.currentTime);
              startRecorderOnce();
              rvfcId = v.requestVideoFrameCallback!(onFrame);
            };
            rvfcId = v.requestVideoFrameCallback(onFrame);
          } else {
            const fallbackPump = () => {
              if (!isExportingRef.current || exportCanceledRef.current) return;
              drawCurrentFrame(v.currentTime);
              demoRafId = requestAnimationFrame(fallbackPump);
            };
            demoRafId = requestAnimationFrame(fallbackPump);
          }

          v.play()
            .then(() => {
              if (hasBgmRef.current && bgmRef.current) bgmRef.current.play().catch(() => {});
              if (typeof v.requestVideoFrameCallback !== 'function') {
                drawCurrentFrame(v.currentTime);
                startRecorderOnce();
              }
            })
            .catch(() => {
              drawCurrentFrame(v.currentTime);
              startRecorderOnce();
            });
        };

        if (isDemoRef.current) {
          beginRecording();
        } else if (videoRef.current) {
          const v = videoRef.current;
          let started = false;
          const safeStart = () => {
            if (started) return;
            started = true;
            v.removeEventListener('seeked', safeStart);
            beginRecording();
          };
          if (!v.seeking && Math.abs(v.currentTime - s.trimStart) < 0.05 && v.readyState >= 2) {
            safeStart();
          } else {
            v.addEventListener('seeked', safeStart);
            window.setTimeout(safeStart, 450);
          }
        }
      },
      [
        cleanupAfterExport,
        drawCurrentFrame,
        exportFormat,
        finishExport,
        getCurrentPlayTime,
        initAudio,
        mediaUrl,
        onNotify,
        togglePlay,
      ]
    );

    const openExportFlow = useCallback(() => {
      if (!hasMediaRef.current && !isDemoRef.current) {
        onNotify('Carga un video o el Clip Demo antes de exportar');
        return;
      }
      if (isExportingRef.current) return;
      setExportOptionsOpen(true);
    }, [onNotify]);

    useImperativeHandle(
      ref,
      () => ({
        triggerExport: openExportFlow,
      }),
      [openExportFlow]
    );

    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#0b0d11]">
        <video
          ref={videoRef}
          playsInline
          crossOrigin="anonymous"
          onLoadedMetadata={handleVideoLoadedMetadata}
          onSeeked={() => {
            if (!isPlayingRef.current) drawCurrentFrame();
          }}
          className="hidden"
        />
        <audio ref={bgmRef} playsInline crossOrigin="anonymous" loop className="hidden" />

        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadStandaloneVideoFile(f);
            e.target.value = '';
          }}
        />
        <input
          ref={relinkInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && activeProject && onRelinkMedia) {
              onRelinkMedia(activeProject.id, f);
            }
            e.target.value = '';
          }}
        />
        <input
          ref={bgmInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleBgmChange}
        />
        <input
          ref={srtInputRef}
          type="file"
          accept=".srt,.txt"
          className="hidden"
          onChange={handleSrtChange}
        />

        {/* Contextual Editor Sub-bar */}
        <div className="h-11 shrink-0 bg-[#10131a] border-b border-white/[0.06] px-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {activeProject ? (
              <>
                <button
                  type="button"
                  onClick={onBackToResults}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white whitespace-nowrap cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Resultados</span>
                </button>
                <span className="text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span className="text-xs font-medium text-slate-300 truncate max-w-[180px]">
                  {activeProject.title}
                </span>
                {activeProject.clips.length > 0 && (
                  <select
                    value={currentClip?.id || ''}
                    onChange={(e) => onSelectClip(e.target.value)}
                    className="bg-[#0b0d12] border border-white/[0.07] rounded-lg px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70 max-w-[260px]"
                  >
                    {activeProject.clips.map((c, idx) => (
                      <option key={c.id} value={c.id}>
                        Clip #{idx + 1} · {c.title} ({c.score}/100)
                      </option>
                    ))}
                  </select>
                )}
                {onOpenManualClipModal && (
                  <button
                    type="button"
                    onClick={() => onOpenManualClipModal(activeProject.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-blue-300 bg-blue-500/12 hover:bg-blue-500/22 whitespace-nowrap cursor-pointer transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Nuevo Clip</span>
                  </button>
                )}
                {!activeProject.isDemo && !hasMedia && !mediaUrl && onRelinkMedia && (
                  <button
                    type="button"
                    onClick={() => relinkInputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-amber-200 bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/25 whitespace-nowrap cursor-pointer"
                  >
                    <FolderOpen className="w-3 h-3" />
                    <span>Re-vincular MP4</span>
                  </button>
                )}
                <span className="hidden xl:inline text-[11px] text-slate-500 whitespace-nowrap">
                  Guardado local automático
                </span>
              </>
            ) : (
              <span className="text-xs font-medium text-slate-400">
                Editor Directo ShortStudio · Sube un clip o usa el Demo
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={!canUndo}
              onClick={handleUndo}
              title="Deshacer (Ctrl+Z)"
              className="p-1.5 rounded-lg text-slate-300 bg-white/[0.04] hover:bg-white/[0.09] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={handleRedo}
              title="Rehacer (Ctrl+Shift+Z)"
              className="p-1.5 rounded-lg text-slate-300 bg-white/[0.04] hover:bg-white/[0.09] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed mr-1.5 transition-colors"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-white/[0.05] hover:bg-white/[0.09] whitespace-nowrap cursor-pointer transition-colors"
            >
              <Film className="w-3.5 h-3.5 text-blue-400" />
              <span>Subir Video</span>
            </button>
            <button
              type="button"
              onClick={() => bgmInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-white/[0.05] hover:bg-white/[0.09] whitespace-nowrap cursor-pointer transition-colors"
            >
              <Music className="w-3.5 h-3.5 text-emerald-400" />
              <span>Música</span>
            </button>
            <button
              type="button"
              onClick={() => srtInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-white/[0.05] hover:bg-white/[0.09] whitespace-nowrap cursor-pointer transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span>Importar .SRT</span>
            </button>
          </div>
        </div>

        {/* 3-Column Studio Workspace */}
        <div className="flex-1 min-h-0 flex">
          <LeftSidebar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            settings={settings}
            duration={duration}
            hasMediaOrDemo={hasMedia || isDemo}
            hasBgm={hasBgm}
            bgmName={bgmName}
            trackingFaces={trackingFaces}
            faceTrackProgress={faceTrackProgress}
            faceTrackStatus={faceTrackStatus}
            analyzingAudio={waveformLoading}
            onUpdateSetting={updateSetting}
            onApplySubtitlePreset={applySubtitlePreset}
            onTrimStartChange={handleTrimStartChange}
            onTrimEndChange={handleTrimEndChange}
            onDetectSilences={handleDetectSilences}
            onRunAudioCleanup={handleRunAudioCleanup}
            cleanupAnalyzing={cleanupAnalyzing}
            onDetectFillers={handleDetectFillers}
            onToggleFillerMark={handleToggleFillerMark}
            onResetFraming={() =>
              setSettings((prev) => ({ ...prev, zoom: 100, panX: 0, panY: 0 }))
            }
            onResetColor={() =>
              setSettings((prev) => ({ ...prev, bright: 100, contrast: 100, sat: 100 }))
            }
            onRemoveBgm={handleRemoveBgm}
            onRunFaceTracking={handleRunFaceTracking}
            onClearFaceTracking={handleClearFaceTracking}
          />

          <PreviewStage
            canvasRef={canvasRef}
            ratio={settings.ratio}
            safeZone={safeZone}
            onSafeZoneChange={setSafeZone}
            faceBox={
              settings.faceTracking && settings.faceKeyframes.length > 0
                ? computeTrackedPlacement(
                    dims.width,
                    dims.height,
                    isDemo ? 1920 : videoRef.current?.videoWidth || 1080,
                    isDemo ? 1080 : videoRef.current?.videoHeight || 1920,
                    settings,
                    currentTime
                  ).faceBoxOnCanvas
                : null
            }
            faceTrackingEnabled={settings.faceTracking}
            showFaceGuide={showFaceGuide}
            onToggleFaceGuide={() => setShowFaceGuide((v) => !v)}
            hasMediaOrDemo={hasMedia || isDemo}
            isPlaying={isPlaying}
            loop={loop}
            currentTime={currentTime}
            duration={duration}
            panX={settings.panX}
            panY={settings.panY}
            onPanChange={(panX, panY) => setSettings((prev) => ({ ...prev, panX, panY }))}
            onDropFile={loadStandaloneVideoFile}
            onChooseVideo={() => videoInputRef.current?.click()}
            onLoadDemo={handleLoadDemo}
            onTogglePlay={() => togglePlay()}
            onToggleLoop={() => setLoop((l) => !l)}
            onSetIn={handleSetIn}
            onSetOut={handleSetOut}
          />

          <RightSidebar
            subtitles={subtitles}
            selectedSubId={selectedSubId}
            currentTime={currentTime}
            duration={duration}
            hasMediaOrDemo={hasMedia || isDemo}
            transcribing={transcribing}
            transcribeProgress={transcribeProgress}
            transcribeStatus={transcribeStatus}
            onTranscribeAudio={handleTranscribeAudio}
            onSelectSub={setSelectedSubId}
            onSeekTo={seekTo}
            onAddSub={handleAddSub}
            onOpenScriptModal={() => setScriptModalOpen(true)}
            onExportSrt={handleExportSrt}
            onUpdateSub={handleUpdateSub}
            onSplitSub={handleSplitSub}
            onMergeNextSub={handleMergeNextSub}
            onDeleteSub={handleDeleteSub}
          />
        </div>

        <Timeline
          duration={duration}
          currentTime={currentTime}
          trimStart={settings.trimStart}
          trimEnd={settings.trimEnd}
          speed={settings.speed}
          hasBgm={hasBgm}
          bgmName={bgmName}
          subtitles={subtitles}
          selectedSubId={selectedSubId}
          audioPeaks={audioProfile?.peaks}
          waveformLoading={waveformLoading}
          silenceCutEnabled={settings.silenceCutEnabled}
          speechSegments={settings.speechSegments}
          onSeek={seekTo}
          onSelectSub={setSelectedSubId}
          onMoveSub={handleMoveSub}
          onTrimStartChange={handleTrimStartChange}
          onTrimEndChange={handleTrimEndChange}
        />

        <ExportOptionsModal
          open={exportOptionsOpen}
          dimensionsLabel={dimsLabel}
          durationSec={getEffectiveOutputDuration(settings)}
          hasWatermark={Boolean(settings.watermarkEnabled && settings.watermarkText?.trim())}
          selectedFormat={exportFormat}
          onSelectFormat={setExportFormat}
          onClose={() => setExportOptionsOpen(false)}
          onStartExport={(fmt) => startExport(fmt)}
        />

        <ExportModal
          open={isExporting}
          progress={exportProgress}
          statusText={exportStatus}
          dimensionsLabel={dimsLabel}
          onCancel={() => {
            exportSignalRef.current.canceled = true;
            exportCanceledRef.current = true;
            finishExport();
          }}
        />

        <ScriptModal
          open={scriptModalOpen}
          onClose={() => setScriptModalOpen(false)}
          onGenerate={handleGenerateScript}
        />
      </div>
    );
  }
);
