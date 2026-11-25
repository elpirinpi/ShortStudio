export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  downloadUrl: string | null;
  assetName: string | null;
  downloadedPath: string | null;
  progress: number;
  error: string | null;
  isPortable: boolean;
  repo: string;
  checkedAt: string | null;
}

export interface ShortStudioDesktopBridge {
  isDesktop: boolean;
  platform: string;
  developer: string;
  version: string;
  repo: string;
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdates: () => Promise<DesktopUpdateState>;
  downloadUpdate: () => Promise<DesktopUpdateState>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  openInstallerFolder?: () => Promise<{ ok: boolean; error?: string }>;
  openReleasePage: () => Promise<void>;
  getRememberedCredentials?: () => Promise<{ email: string; password: string; encrypted: boolean }>;
  saveRememberedCredentials?: (creds: {
    email: string;
    password: string;
  }) => Promise<{ ok: boolean; encrypted: boolean }>;
  clearRememberedCredentials?: () => Promise<{ ok: boolean }>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

declare global {
  interface Window {
    shortStudioDesktop?: ShortStudioDesktopBridge;
  }
}
