export type FitMode = 'cover' | 'blur' | 'fit';
export type TargetRatio = '9:16' | '1:1' | '16:9';
export type SafeZoneMode = 'none' | 'tiktok' | 'shorts' | 'grid';
export type SubMode = 'karaoke' | 'reveal' | 'bounce' | 'classic';
export type SubBgMode = 'none' | 'word-pill' | 'line-box' | 'glass-card';
export type ProgressPos = 'top' | 'bottom';
export type WatermarkPos = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type LeftTab = 'format' | 'subs' | 'color';

export type AppView =
  | 'create'
  | 'projects'
  | 'results'
  | 'editor'
  | 'scheduler'
  | 'settings';

export type SubtitlePresetId =
  | 'hormozi'
  | 'mrbeast'
  | 'capcut'
  | 'tiktok'
  | 'glass'
  | 'minimal';

export type TargetDuration = 'auto' | '<30s' | '30-60s';
export type AiEngineMode = 'whisper-local' | 'acoustic-fast';
export type WhisperModelId = 'Xenova/whisper-tiny' | 'Xenova/whisper-base';

export interface FaceKeyframe {
  time: number;
  x: number; // normalized center X (0..1) in source video
  y: number; // normalized center Y (0..1) in source video
  w: number; // normalized box width (0..1)
  h: number; // normalized box height (0..1)
  confidence: number;
}

export interface SubtitleCue {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface EditorSettings {
  ratio: TargetRatio;
  fitMode: FitMode;
  zoom: number;
  panX: number;
  panY: number;
  rounded: boolean;

  faceTracking: boolean;
  faceSmoothing: number;
  faceHeadroom: number;
  faceKeyframes: FaceKeyframe[];
  faceEngineUsed?: string;

  trimStart: number;
  trimEnd: number;
  speed: number;

  progressBar: boolean;
  progressPos: ProgressPos;
  progressColor: string;

  subMode: SubMode;
  subBgMode: SubBgMode;
  subPop: boolean;
  subUpper: boolean;
  subFont: string;
  subSize: number;
  subY: number;
  subStroke: number;
  subShadow: number;
  subMaxWidth: number;
  subColor: string;
  subHighlight: string;
  subStrokeColor: string;
  subBgColor: string;

  bright: number;
  contrast: number;
  sat: number;
  volVideo: number;
  volBgm: number;

  watermarkEnabled?: boolean;
  watermarkText?: string;
  watermarkPos?: WatermarkPos;
  watermarkOpacity?: number;
}

export interface SignalBreakdown {
  vocalEnergy: number;
  pacing: number;
  hookStrength: number;
  visualDynamics: number;
}

export interface TranscriptWord {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: TranscriptWord[];
}

export interface GeneratedClip {
  id: string;
  title: string;
  start: number;
  end: number;
  duration: number;
  score: number;
  viralReason: string;
  keywords: string[];
  signalBreakdown: SignalBreakdown;
  subtitles: SubtitleCue[];
  editorSettings: EditorSettings;
  transcriptSnippet: string;
}

export interface ProjectConfig {
  ratio: TargetRatio;
  framing: FitMode;
  targetDuration: TargetDuration;
  language: string;
  subtitlePreset: SubtitlePresetId;
  generateProgressBar: boolean;
  autoFaceTrack: boolean;
}

export interface ClipProject {
  id: string;
  title: string;
  status: 'completed' | 'draft' | 'error';
  createdAt: string;
  updatedAt: string;
  mediaBlobId: string | null;
  mediaName: string;
  isDemo: boolean;
  duration: number;
  width: number;
  height: number;
  thumbnailDataUrl: string | null;
  config: ProjectConfig;
  transcript: TranscriptSegment[];
  clips: GeneratedClip[];
  aiEngineUsed: string;
}

export type SocialPlatform = 'youtube_shorts' | 'tiktok' | 'instagram_reels';

export interface ScheduledPost {
  id: string;
  projectId: string;
  clipId: string;
  projectTitle: string;
  clipTitle: string;
  platform: SocialPlatform;
  scheduledAt: string;
  caption: string;
  hashtags: string;
  visibility: 'public' | 'unlisted' | 'private';
  status: 'scheduled' | 'ready' | 'published';
}

export interface YouTubeBlockedInfo {
  url: string;
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  embedUrl: string;
  watchUrl: string;
  reason: string;
}

export interface AppSettings {
  aiEngine: AiEngineMode;
  whisperModel: WhisperModelId;
  defaultLanguage: string;
  defaultRatio: TargetRatio;
  defaultFraming: FitMode;
  defaultPreset: SubtitlePresetId;
  youtubeCookie?: string;
  localConnectorToken?: string;
}

export const DEFAULT_SUBTITLES: SubtitleCue[] = [
  { id: 1, start: 0.2, end: 2.3, text: 'LOS PRIMEROS *3 SEGUNDOS*' },
  { id: 2, start: 2.4, end: 4.8, text: 'DECIDEN SI TU *VIDEO*' },
  { id: 3, start: 4.9, end: 7.4, text: 'SE HACE *VIRAL*' },
  { id: 4, start: 7.5, end: 11.4, text: 'EDITA COMO UN *PRO* EN 9:16' },
];

export const DEFAULT_SETTINGS: EditorSettings = {
  ratio: '9:16',
  fitMode: 'cover',
  zoom: 100,
  panX: 0,
  panY: 0,
  rounded: true,

  faceTracking: false,
  faceSmoothing: 72,
  faceHeadroom: 36,
  faceKeyframes: [],

  trimStart: 0,
  trimEnd: 12,
  speed: 1,

  progressBar: true,
  progressPos: 'top',
  progressColor: '#f43f5e',

  subMode: 'karaoke',
  subBgMode: 'none',
  subPop: true,
  subUpper: true,
  subFont: "'Montserrat', Impact, sans-serif",
  subSize: 68,
  subY: 68,
  subStroke: 13,
  subShadow: 18,
  subMaxWidth: 860,
  subColor: '#ffffff',
  subHighlight: '#facc15',
  subStrokeColor: '#000000',
  subBgColor: '#0f172a',

  bright: 100,
  contrast: 100,
  sat: 100,
  volVideo: 100,
  volBgm: 35,

  watermarkEnabled: false,
  watermarkText: '@tu_canal',
  watermarkPos: 'top-right',
  watermarkOpacity: 75,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  aiEngine: 'whisper-local',
  whisperModel: 'Xenova/whisper-tiny',
  defaultLanguage: 'es',
  defaultRatio: '9:16',
  defaultFraming: 'cover',
  defaultPreset: 'hormozi',
  youtubeCookie: '',
};

export function getPresetPatch(preset: SubtitlePresetId): Partial<EditorSettings> {
  switch (preset) {
    case 'hormozi':
      return {
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
      };
    case 'mrbeast':
      return {
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
      };
    case 'capcut':
      return {
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
      };
    case 'tiktok':
      return {
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
      };
    case 'glass':
      return {
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
      };
    case 'minimal':
      return {
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
      };
  }
}

export function getCanvasDimensions(ratio: TargetRatio): { width: number; height: number } {
  if (ratio === '1:1') return { width: 1080, height: 1080 };
  if (ratio === '16:9') return { width: 1920, height: 1080 };
  return { width: 1080, height: 1920 };
}
