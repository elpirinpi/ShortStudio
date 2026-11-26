import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Innertube } from 'youtubei.js';
import { buildAssSubtitles, type AssBuilderSettings, type AssSubtitleCue } from './server/assBuilder.ts';
import { cleanupOrphanedTempFiles } from './server/cleanup.ts';
import {
  buildAudioCleanupFilters,
  normalizeAudioCleanupOptions,
  parseFfmpegDuration,
  parseLoudnormMeasured,
  parseSilenceDetectOutput,
} from './server/audioCleanup.ts';
import {
  buildDuckingFilter,
  buildEmphasisZoomFilter,
  buildSfxSourceFilters,
  finishDuckingActive,
  finishSfxActive,
  finishZoomActive,
  highlightKeywordsInCues,
  normalizeFinishClipOptions,
} from './server/finishClip.ts';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 3000);
const MAX_VIDEO_BYTES = 450 * 1024 * 1024; // 450 MB safety cap
// C1 (auditoría): la API local exige un token. Se acepta en la cabecera
// X-ShortStudio-Token (mismo nombre que ya usa el conector de Windows) o
// en la cookie que el propio servidor entrega al servir el frontend.
const API_TOKEN_HEADER = 'x-shortstudio-token';
const API_TOKEN_COOKIE = 'shortstudio_api_token';
const IS_WINDOWS = process.platform === 'win32';
const YTDLP_RELEASE_URL = IS_WINDOWS
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
// FFmpeg Windows builds, tried in order until one downloads and runs.
// The first is the small "essentials" build; the others are full builds
// from GitHub used as automatic fallbacks.
const FFMPEG_WIN_ZIP_URLS = [
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  'https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip',
];
const DENO_WIN_ZIP_URL =
  'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
const IOS_UA = 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)';
const ANDROID_UA = 'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip';

type ClientCandidate = 'IOS' | 'ANDROID_VR' | 'ANDROID' | 'TV' | 'WEB';

interface YouTubeOEmbed {
  title: string;
  author: string;
  thumbnailUrl: string;
}

let activeBinDir: string | null = null;
let activeMediaDir: string | null = process.env.SHORTSTUDIO_MEDIA_DIR || null;
let cachedYtDlpPath: string | null = null;
let cachedFfmpegPath: string | null = null;
let cachedDenoPath: string | null = null;
let cachedFfprobePath: string | null = null;
// A failed Deno download is remembered for the process (Deno is
// optional). FFmpeg is mandatory, so it is NOT memoized: every download
// attempt re-checks it, deletes a corrupt copy and reinstalls it
// automatically when needed.
let denoDownloadFailed = false;

function getRuntimeBinDir(): string {
  if (activeBinDir) return activeBinDir;
  if (process.env.SHORTSTUDIO_BIN_DIR) return process.env.SHORTSTUDIO_BIN_DIR;
  if (IS_WINDOWS) {
    return path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ShortStudioConnector');
  }
  return os.tmpdir();
}

async function ensureYtDlp(): Promise<string> {
  if (cachedYtDlpPath && fs.existsSync(cachedYtDlpPath)) {
    return cachedYtDlpPath;
  }

  const binDir = getRuntimeBinDir();
  const binName = IS_WINDOWS ? 'yt-dlp.exe' : 'yt-dlp';
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;

  const candidates = [
    path.join(binDir, binName),
    ...(resourcesPath ? [path.join(resourcesPath, 'bin', binName)] : []),
    path.resolve(process.cwd(), 'bin', binName),
    ...(IS_WINDOWS
      ? [
          path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ShortStudioConnector', 'yt-dlp.exe'),
        ]
      : ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp']),
    path.join(os.tmpdir(), binName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      // A tiny yt-dlp file is a truncated leftover of an interrupted
      // download (the real binary is ~17 MB): delete it and reinstall
      // instead of failing on every attempt.
      try {
        if (fs.statSync(candidate).size < 1_000_000) {
          await fs.promises.rm(candidate, { force: true });
          continue;
        }
      } catch {
        // if it cannot be inspected, fall through and try to use it
      }
      if (!IS_WINDOWS) {
        try {
          fs.chmodSync(candidate, 0o755);
        } catch {
          // ignore chmod errors on read-only paths
        }
      }
      cachedYtDlpPath = candidate;
      return candidate;
    }
  }

  fs.mkdirSync(binDir, { recursive: true });
  const targetBin = path.join(binDir, binName);
  const resp = await fetch(YTDLP_RELEASE_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`No se pudo descargar yt-dlp (HTTP ${resp.status}).`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.promises.writeFile(targetBin, buf, { mode: 0o755 });
  if (!IS_WINDOWS) {
    fs.chmodSync(targetBin, 0o755);
  }
  cachedYtDlpPath = targetBin;
  return targetBin;
}


async function extractZipWindows(zipPath: string, destDir: string): Promise<boolean> {
  try {
    await fs.promises.mkdir(destDir, { recursive: true });
  } catch {
    // ignore: the extractors below will surface a real failure
  }
  // First choice: tar.exe (bsdtar), included in Windows 10 1803+ and
  // Windows 11. It extracts ZIP files far faster and more reliably than
  // Expand-Archive from Windows PowerShell 5.1, which was the main cause
  // of the long hang on Windows 10.
  try {
    await execFileAsync('tar.exe', ['-xf', zipPath, '-C', destDir], { timeout: 180000 });
    return true;
  } catch {
    // fall through to the PowerShell fallback
  }
  try {
    await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ],
      { timeout: 180000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function verifyBinaryResponds(bin: string): Promise<boolean> {
  try {
    // 10s: a freshly installed binary can be slow to start the first
    // time while Windows Defender scans it.
    await execFileAsync(bin, ['-version'], { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

function resolveFfprobePathSync(ffmpegPath?: string | null): string | null {
  if (cachedFfprobePath && fs.existsSync(cachedFfprobePath)) {
    return cachedFfprobePath;
  }
  const binName = IS_WINDOWS ? 'ffprobe.exe' : 'ffprobe';
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
  const candidates: string[] = [];
  if (ffmpegPath && ffmpegPath.includes(path.sep)) {
    candidates.push(path.join(path.dirname(ffmpegPath), binName));
  }
  candidates.push(path.join(getRuntimeBinDir(), binName));
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'bin', binName));
  candidates.push(path.resolve(process.cwd(), 'bin', binName));
  if (IS_WINDOWS) {
    candidates.push(
      path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ShortStudioConnector', binName)
    );
  } else {
    candidates.push('/usr/bin/ffprobe', '/usr/local/bin/ffprobe');
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedFfprobePath = candidate;
      return candidate;
    }
  }
  return null;
}

async function resolveFfprobePath(ffmpegPath?: string | null): Promise<string | null> {
  const sync = resolveFfprobePathSync(ffmpegPath);
  if (sync) return sync;
  try {
    if (IS_WINDOWS) {
      const { stdout } = await execFileAsync('where.exe', ['ffprobe'], { timeout: 4000 });
      const first = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      if (first && fs.existsSync(first)) {
        cachedFfprobePath = first;
        return first;
      }
    } else if (await verifyBinaryResponds('ffprobe')) {
      return 'ffprobe';
    }
  } catch {
    // ffprobe stays unresolved; callers decide how strict to be
  }
  return null;
}

// FFmpeg is mandatory when yt-dlp downloads separate video+audio tracks:
// without it the tracks are never merged. A path is only accepted when
// the binary actually runs: a corrupt ffmpeg.exe that merely exists on
// disk is rejected so the caller can reinstall it automatically.
async function verifyFfmpegForMerge(
  ffmpegPath: string
): Promise<{ ffmpegPath: string; ffprobePath: string | null } | null> {
  if (ffmpegPath && ffmpegPath !== 'ffmpeg') {
    if (!fs.existsSync(ffmpegPath)) return null;
    if (!(await verifyBinaryResponds(ffmpegPath))) return null;
    const ffprobePath = await resolveFfprobePath(ffmpegPath);
    return { ffmpegPath, ffprobePath };
  }
  if (await verifyBinaryResponds('ffmpeg')) {
    const ffprobePath = await resolveFfprobePath(null);
    return { ffmpegPath: 'ffmpeg', ffprobePath };
  }
  return null;
}

async function fileHasAudioStream(ffprobePath: string, filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'csv=p=0',
        filePath,
      ],
      { timeout: 30000 }
    );
    return stdout.split(/\r?\n/).some((l) => l.trim() === 'audio');
  } catch {
    return false;
  }
}

function resolveFfmpegPathSync(): string | null {
  if (cachedFfmpegPath && fs.existsSync(cachedFfmpegPath)) {
    return cachedFfmpegPath;
  }
  const binDir = getRuntimeBinDir();
  const binName = IS_WINDOWS ? 'ffmpeg.exe' : 'ffmpeg';
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;

  const candidates = [
    path.join(binDir, binName),
    ...(resourcesPath ? [path.join(resourcesPath, 'bin', binName)] : []),
    path.resolve(process.cwd(), 'bin', binName),
    ...(IS_WINDOWS
      ? [
          path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ShortStudioConnector', 'ffmpeg.exe'),
        ]
      : ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedFfmpegPath = candidate;
      return candidate;
    }
  }
  return null;
}

interface EnsureRuntimeOptions {
  force?: boolean;
  onLabel?: (label: string) => void;
}

// Streams a download to disk with progress reporting, an idle timeout
// (reset by every received chunk, so a stalled connection aborts
// instead of hanging forever) and a generous total cap. Returns false
// on any failure and removes the partial file.
async function downloadToFile(
  url: string,
  destPath: string,
  opts?: {
    idleTimeoutMs?: number;
    totalTimeoutMs?: number;
    onProgress?: (downloaded: number, total: number | null) => void;
  }
): Promise<boolean> {
  const idleTimeoutMs = opts?.idleTimeoutMs ?? 90_000;
  const totalTimeoutMs = opts?.totalTimeoutMs ?? 600_000;
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const totalTimer = setTimeout(() => controller.abort(), totalTimeoutMs);
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
  };
  try {
    armIdle();
    const resp = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!resp.ok || !resp.body) return false;
    const totalHeader = Number(resp.headers.get('content-length'));
    const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
    const ws = fs.createWriteStream(destPath);
    let writeError: Error | null = null;
    ws.on('error', (e) => {
      writeError = e;
    });
    let downloaded = 0;
    let lastReportedPct = -1;
    for await (const chunk of resp.body as unknown as AsyncIterable<Uint8Array>) {
      armIdle();
      const buf = Buffer.from(chunk);
      downloaded += buf.byteLength;
      if (writeError) throw writeError;
      if (!ws.write(buf)) {
        await new Promise<void>((resolve, reject) => {
          ws.once('drain', resolve);
          ws.once('error', reject);
        });
      }
      if (opts?.onProgress) {
        const pct = total ? Math.floor((downloaded / total) * 100) : null;
        if (pct === null || pct >= lastReportedPct + 2 || downloaded === total) {
          if (pct !== null) lastReportedPct = pct;
          opts.onProgress(downloaded, total);
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      ws.once('error', reject);
      ws.end(() => resolve());
    });
    if (writeError) throw writeError;
    return downloaded > 0;
  } catch {
    try {
      await fs.promises.rm(destPath, { force: true });
    } catch {
      // ignore cleanup errors
    }
    return false;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  }
}

async function ensureFfmpeg(opts?: EnsureRuntimeOptions): Promise<string> {
  if (!IS_WINDOWS) {
    return 'ffmpeg';
  }
  const binDir = getRuntimeBinDir();
  const targetExe = path.join(binDir, 'ffmpeg.exe');

  if (!opts?.force) {
    // Accept an existing ffmpeg.exe only if it actually runs. A corrupt
    // or partial leftover (for example from an interrupted install by
    // an older version) is deleted and reinstalled automatically
    // instead of being trusted forever.
    for (let attempt = 0; attempt < 6; attempt++) {
      const existing = resolveFfmpegPathSync();
      if (!existing) break;
      if (await verifyBinaryResponds(existing)) {
        cachedFfmpegPath = existing;
        return existing;
      }
      try {
        await fs.promises.rm(existing, { force: true });
      } catch {
        break;
      }
      if (cachedFfmpegPath === existing) cachedFfmpegPath = null;
    }
    try {
      const { stdout } = await execFileAsync('where.exe', ['ffmpeg'], { timeout: 4000 });
      const first = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      if (first && fs.existsSync(first) && (await verifyBinaryResponds(first))) {
        cachedFfmpegPath = first;
        return first;
      }
    } catch {
      // fall through to the automatic install below
    }
  }

  // Automatic install: try each mirror until one produces an
  // ffmpeg.exe (plus ffprobe.exe) that actually runs. Progress is
  // reported the whole time, so the UI never sits silently on
  // "Verificando FFmpeg..." while tens of MB are downloaded.
  fs.mkdirSync(binDir, { recursive: true });
  const findExe = (dir: string, name: string): string | null => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findExe(full, name);
        if (found) return found;
      } else if (entry.name.toLowerCase() === name) {
        return full;
      }
    }
    return null;
  };

  for (const url of FFMPEG_WIN_ZIP_URLS) {
    const tmpZip = path.join(os.tmpdir(), `ss_ffmpeg_${Date.now()}.zip`);
    const tmpExtract = path.join(os.tmpdir(), `ss_ffmpeg_ex_${Date.now()}`);
    try {
      opts?.onLabel?.('FFmpeg no esta listo: descargandolo automaticamente...');
      const okDownload = await downloadToFile(url, tmpZip, {
        idleTimeoutMs: 90_000,
        totalTimeoutMs: 600_000,
        onProgress: (downloaded, total) => {
          if (total) {
            const pct = Math.min(99, Math.floor((downloaded / total) * 100));
            opts?.onLabel?.(`Descargando FFmpeg automaticamente... ${pct}%`);
          } else {
            opts?.onLabel?.(
              `Descargando FFmpeg automaticamente... ${Math.round(downloaded / (1024 * 1024))} MB`
            );
          }
        },
      });
      if (!okDownload) continue;
      opts?.onLabel?.('Instalando FFmpeg...');
      const extractedZip = await extractZipWindows(tmpZip, tmpExtract);
      if (!extractedZip) continue;
      const found = findExe(tmpExtract, 'ffmpeg.exe');
      if (!found) continue;
      await fs.promises.copyFile(found, targetExe);
      // The FFmpeg builds ship ffprobe.exe next to ffmpeg.exe: keep it
      // too, it is needed to verify the merged file really has audio.
      const siblingFfprobe = path.join(path.dirname(found), 'ffprobe.exe');
      if (fs.existsSync(siblingFfprobe)) {
        const targetFfprobe = path.join(binDir, 'ffprobe.exe');
        try {
          await fs.promises.copyFile(siblingFfprobe, targetFfprobe);
          cachedFfprobePath = targetFfprobe;
        } catch {
          // ffprobe can still be resolved later from other locations
        }
      }
      if (await verifyBinaryResponds(targetExe)) {
        cachedFfmpegPath = targetExe;
        opts?.onLabel?.('FFmpeg instalado y verificado.');
        return targetExe;
      }
      try {
        await fs.promises.rm(targetExe, { force: true });
      } catch {
        // ignore: the next mirror overwrites it anyway
      }
    } catch {
      // try the next mirror
    } finally {
      fs.promises.rm(tmpZip, { force: true }).catch(() => {});
      fs.promises.rm(tmpExtract, { recursive: true, force: true }).catch(() => {});
    }
  }

  return 'ffmpeg';
}

async function ensureDenoOnWindows(): Promise<string | null> {
  if (!IS_WINDOWS) return null;
  if (cachedDenoPath && fs.existsSync(cachedDenoPath)) return cachedDenoPath;

  const binDir = getRuntimeBinDir();
  const candidates = [
    path.join(binDir, 'deno.exe'),
    path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ShortStudioConnector', 'deno.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedDenoPath = c;
      return c;
    }
  }

  if (denoDownloadFailed) {
    // Deno is optional: a failed preparation is remembered for this
    // process instead of being retried on every download attempt.
    return null;
  }

  fs.mkdirSync(binDir, { recursive: true });
  const targetDeno = path.join(binDir, 'deno.exe');
  const tmpZip = path.join(os.tmpdir(), `ss_deno_${Date.now()}.zip`);
  try {
    const resp = await fetch(DENO_WIN_ZIP_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok || !resp.body) {
      denoDownloadFailed = true;
      return null;
    }
    await fs.promises.writeFile(tmpZip, Buffer.from(await resp.arrayBuffer()));
    const extractedDenoZip = await extractZipWindows(tmpZip, binDir);
    if (!extractedDenoZip) {
      denoDownloadFailed = true;
      return null;
    }
    if (fs.existsSync(targetDeno)) {
      cachedDenoPath = targetDeno;
      return targetDeno;
    }
  } catch {
    denoDownloadFailed = true;
    // optional
  } finally {
    fs.promises.rm(tmpZip, { force: true }).catch(() => {});
  }
  denoDownloadFailed = true;
  return null;
}

function extractYouTubeId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
      const vParam = u.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) return vParam;

      const parts = u.pathname.split('/').filter(Boolean);
      if (
        parts.length >= 2 &&
        (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v')
      ) {
        const id = parts[1];
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === '[::1]' ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  if (/^(10\.|127\.|169\.254\.|192\.168\.)/.test(h)) return true;
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172) {
    const oct = Number(m172[1]);
    if (oct >= 16 && oct <= 31) return true;
  }
  return false;
}

function validateExternalUrl(
  rawUrl: string
): { ok: true; url: URL } | { ok: false; status: number; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, status: 400, error: 'La URL proporcionada no es válida.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, status: 400, error: 'Solo se admiten enlaces http:// o https://.' };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, status: 403, error: 'Host no permitido por seguridad.' };
  }
  return { ok: true, url: parsed };
}

function normalizeDirectVideoUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes('dropbox.com')) {
      u.searchParams.set('dl', '1');
      return u.toString();
    }
    if (u.hostname === 'github.com' && u.pathname.includes('/blob/')) {
      return rawUrl
        .replace('https://github.com/', 'https://raw.githubusercontent.com/')
        .replace('/blob/', '/');
    }
  } catch {
    // ignore
  }
  return rawUrl;
}

async function fetchYouTubeOEmbed(videoId: string): Promise<YouTubeOEmbed> {
  const fallback: YouTubeOEmbed = {
    title: `YouTube_${videoId}`,
    author: 'YouTube',
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      title: data.title || fallback.title,
      author: data.author_name || fallback.author,
      thumbnailUrl: data.thumbnail_url || fallback.thumbnailUrl,
    };
  } catch {
    return fallback;
  }
}

interface YtDlpResult {
  ok: true;
  filePath: string;
  title: string;
  extractor: string;
  mimeType: string;
  cleanup: () => Promise<void>;
}

interface YtDlpError {
  ok: false;
  reason: string;
}

function formatBytesPerSec(rawSpeed: string): string {
  const num = Number(rawSpeed);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB/s`;
  if (num >= 1024) return `${(num / 1024).toFixed(0)} KB/s`;
  return `${Math.round(num)} B/s`;
}

interface YtDlpControl {
  signal?: AbortSignal;
  onSpawn?: (child: ChildProcess) => void;
}

async function runYtDlpDownload(
  targetUrl: string,
  extraArgs: string[] = [],
  onProgress?: (percent: number, label: string) => void,
  control?: YtDlpControl
): Promise<YtDlpResult | YtDlpError> {
  if (control?.signal?.aborted) {
    return { ok: false, reason: 'Descarga cancelada por el usuario.' };
  }
  onProgress?.(4, 'Preparando motor yt-dlp...');
  const ytDlpBin = await ensureYtDlp();
  if (control?.signal?.aborted) {
    return { ok: false, reason: 'Descarga cancelada por el usuario.' };
  }
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ytdlp_ss_'));

  const cleanup = async () => {
    try {
      await fs.promises.rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  try {
    const args: string[] = [
      '--no-warnings',
      '--no-playlist',
      '--force-overwrites',
      '--newline',
      '--progress',
      '--progress-template',
      'download:SS_PROG:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s',
      '--max-filesize',
      '450M',
      '-f',
      'bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b',
      '--merge-output-format',
      'mp4',
      '-o',
      path.join(workDir, 'clip.%(ext)s'),
      '--print',
      'after_move:%(title)s\t%(extractor_key)s\t%(filepath)s',
      ...extraArgs,
    ];

    if (IS_WINDOWS) {
      onProgress?.(5, 'Verificando runtime Deno (opcional)...');
      const denoExe = await ensureDenoOnWindows();
      if (denoExe) {
        args.push('--js-runtimes', `deno:${denoExe}`, '--remote-components', 'ejs:github');
      }
    } else if (!('electron' in process.versions)) {
      args.push('--js-runtimes', `node:${process.execPath}`);
    }

    onProgress?.(6, 'Verificando FFmpeg (necesario para unir video y audio)...');
    const onFfmpegLabel = (label: string) => onProgress?.(6, label);
    let ffmpegPath = await ensureFfmpeg({ onLabel: onFfmpegLabel });
    let verifiedFfmpeg = await verifyFfmpegForMerge(ffmpegPath);
    if (!verifiedFfmpeg) {
      // Self-healing retry: force a clean automatic reinstall of
      // FFmpeg and check again before giving up on the download.
      onProgress?.(6, 'FFmpeg no respondio: reinstalando automaticamente...');
      ffmpegPath = await ensureFfmpeg({ force: true, onLabel: onFfmpegLabel });
      verifiedFfmpeg = await verifyFfmpegForMerge(ffmpegPath);
    }
    if (!verifiedFfmpeg) {
      await cleanup();
      return {
        ok: false,
        reason:
          'No se pudo instalar FFmpeg automaticamente en tu PC. FFmpeg es necesario para unir el video y el audio, asi que no se entrego una descarga sin audio. Revisa tu conexion a internet e intentalo de nuevo.',
      };
    }
    const mergeFfmpegPath = verifiedFfmpeg.ffmpegPath;
    const ffprobePath = verifiedFfmpeg.ffprobePath;
    if (mergeFfmpegPath !== 'ffmpeg') {
      args.push('--ffmpeg-location', mergeFfmpegPath);
    }
    onProgress?.(7, 'Runtime listo. Conectando con YouTube...');

    args.push('--', targetUrl);
    onProgress?.(8, 'Conectando y obteniendo formatos de video...');

    let highestPct = 8;
    let streamCount = 0;

    const { stdout, stderr, exitCode } = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>((resolve, reject) => {
      const child = spawn(ytDlpBin, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      control?.onSpawn?.(child);

      let stdoutBuf = '';
      let stderrBuf = '';
      let outLineBuf = '';
      let errLineBuf = '';
      let aborted = false;

      // Inactivity watchdog: a healthy download keeps producing
      // progress output, so the timer only fires after 3 minutes of
      // complete silence from yt-dlp (a long FFmpeg merge on a slow
      // disk included), not merely because a download is large/slow.
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const armWatchdog = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          try {
            child.kill('SIGTERM');
          } catch {
            // ignore
          }
          control?.signal?.removeEventListener('abort', onAbort);
          reject(new Error('Tiempo de espera agotado descargando el video.'));
        }, 180_000);
      };

      const onAbort = () => {
        aborted = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        if (timeoutTimer) clearTimeout(timeoutTimer);
        reject(new Error('Descarga cancelada por el usuario.'));
      };
      control?.signal?.addEventListener('abort', onAbort, { once: true });
      armWatchdog();

      const handleLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line) return;

        if (line.includes('[download] Destination:')) {
          streamCount += 1;
          if (streamCount === 1) {
            highestPct = Math.max(highestPct, 10);
            onProgress?.(highestPct, 'Descargando pista de video 1080p...');
          } else {
            highestPct = Math.max(highestPct, 78);
            onProgress?.(highestPct, 'Descargando pista de audio...');
          }
          return;
        }

        if (
          line.includes('[Merger]') ||
          line.includes('Merging formats into') ||
          line.includes('[Fixup')
        ) {
          highestPct = Math.max(highestPct, 94);
          onProgress?.(highestPct, 'Uniendo video y audio MP4 con FFmpeg...');
          return;
        }

        const progIdx = line.indexOf('SS_PROG:');
        if (progIdx !== -1) {
          const payload = line.slice(progIdx + 'SS_PROG:'.length);
          const [rawPct, rawDown, rawTotal, rawEstimate, rawSpeed] = payload.split('|');
          const pctMatch = (rawPct || '').match(/([\d.]+)/);
          let rawPercent = pctMatch ? parseFloat(pctMatch[1]) : NaN;
          if (!Number.isFinite(rawPercent)) {
            const d = Number(rawDown);
            const t = Number(rawTotal) || Number(rawEstimate);
            if (Number.isFinite(d) && Number.isFinite(t) && t > 0) {
              rawPercent = (d / t) * 100;
            }
          }
          if (Number.isFinite(rawPercent)) {
            const clamped = Math.max(0, Math.min(100, rawPercent));
            const mapped =
              streamCount <= 1
                ? Math.round(10 + (clamped / 100) * 68)
                : Math.round(78 + (clamped / 100) * 15);
            highestPct = Math.max(highestPct, Math.min(93, mapped));
            const speedTxt = formatBytesPerSec(rawSpeed || '');
            const phaseLabel =
              streamCount <= 1 ? 'Descargando video' : 'Descargando audio';
            onProgress?.(
              highestPct,
              `${phaseLabel}... ${Math.round(clamped)}%${speedTxt ? ` (${speedTxt})` : ''}`
            );
          }
          return;
        }

        const fallbackPct = line.match(/\[download\]\s+([\d.]+)%/);
        if (fallbackPct) {
          const rawPercent = parseFloat(fallbackPct[1]);
          if (Number.isFinite(rawPercent)) {
            const mapped =
              streamCount <= 1
                ? Math.round(10 + (rawPercent / 100) * 68)
                : Math.round(78 + (rawPercent / 100) * 15);
            highestPct = Math.max(highestPct, Math.min(93, mapped));
            onProgress?.(highestPct, `Descargando MP4... ${Math.round(rawPercent)}%`);
          }
        }
      };

      const feedLines = (chunk: Buffer, isErr: boolean) => {
        armWatchdog();
        const text = chunk.toString('utf8');
        if (isErr) {
          stderrBuf += text;
          errLineBuf += text;
          const parts = errLineBuf.split(/\r?\n|\r/);
          errLineBuf = parts.pop() || '';
          for (const p of parts) handleLine(p);
        } else {
          stdoutBuf += text;
          outLineBuf += text;
          const parts = outLineBuf.split(/\r?\n|\r/);
          outLineBuf = parts.pop() || '';
          for (const p of parts) handleLine(p);
        }
      };

      child.stdout?.on('data', (c: Buffer) => feedLines(c, false));
      child.stderr?.on('data', (c: Buffer) => feedLines(c, true));
      child.on('error', (err) => {
        clearTimeout(timeoutTimer);
        control?.signal?.removeEventListener('abort', onAbort);
        if (!aborted) reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timeoutTimer);
        control?.signal?.removeEventListener('abort', onAbort);
        if (aborted) return;
        if (outLineBuf) handleLine(outLineBuf);
        if (errLineBuf) handleLine(errLineBuf);
        resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: code ?? 1 });
      });
    });

    if (exitCode !== 0 && !stdout.trim()) {
      const cleanReason =
        stderr
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith('ERROR:'))
          .join(' ')
          .replace(/See\s+https?:\/\/\S+.*$/i, '')
          .trim() || stderr.trim() || `yt-dlp terminó con código ${exitCode}.`;
      await cleanup();
      return { ok: false, reason: cleanReason };
    }

    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const lastLine = lines[lines.length - 1] || '';
    const [printedTitle, printedExtractor, printedPath] = lastLine.split('\t');

    // Partial per-format files (clip.f399.mp4, clip.f140.m4a, ...) are
    // the unmerged video/audio tracks: never deliver one of those.
    const isPartialFormatFile = (name: string) => /\.f\d+\./i.test(name);
    let downloadedPath = printedPath ? path.resolve(printedPath) : '';
    if (
      !downloadedPath ||
      !downloadedPath.startsWith(workDir + path.sep) ||
      !fs.existsSync(downloadedPath) ||
      isPartialFormatFile(path.basename(downloadedPath))
    ) {
      const entries = await fs.promises.readdir(workDir);
      const mediaFiles = entries.filter(
        (name) => /\.(mp4|webm|mkv|mov|m4v)$/i.test(name) && !isPartialFormatFile(name)
      );
      // Prefer the merged output file (clip.mp4) over any other candidate.
      const mediaFile =
        mediaFiles.find((name) => name.toLowerCase() === 'clip.mp4') || mediaFiles[0];
      if (!mediaFile) {
        await cleanup();
        return {
          ok: false,
          reason: 'yt-dlp no generó un archivo de video válido.',
        };
      }
      downloadedPath = path.join(workDir, mediaFile);
    }

    const stat = await fs.promises.stat(downloadedPath);
    if (stat.size === 0) {
      await cleanup();
      return { ok: false, reason: 'El archivo descargado está vacío.' };
    }
    if (stat.size > MAX_VIDEO_BYTES) {
      await cleanup();
      return { ok: false, reason: 'El video supera el límite de 450 MB.' };
    }

    // Verify, before reporting success, that the final file really has
    // an audio stream, and treat a non-zero yt-dlp exit code as an error
    // unless that verified final file exists.
    onProgress?.(95, 'Verificando que el video descargado tenga audio...');
    const effectiveFfprobe = ffprobePath ?? (await resolveFfprobePath(mergeFfmpegPath));
    let audioVerified = false;
    if (effectiveFfprobe) {
      audioVerified = await fileHasAudioStream(effectiveFfprobe, downloadedPath);
      if (!audioVerified) {
        await cleanup();
        return {
          ok: false,
          reason:
            'La descarga termino sin pista de audio: el video y el audio no se pudieron unir. No se entrego el video sin audio.',
        };
      }
    } else if (IS_WINDOWS) {
      await cleanup();
      return {
        ok: false,
        reason:
          'No se encontro ffprobe junto a FFmpeg para verificar el audio de la descarga.',
      };
    }
    if (exitCode !== 0 && !audioVerified) {
      const cleanReason =
        stderr
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith('ERROR:'))
          .join(' ')
          .replace(/See\s+https?:\/\/\S+.*$/i, '')
          .trim() || stderr.trim() || `yt-dlp terminó con código ${exitCode}.`;
      await cleanup();
      return { ok: false, reason: cleanReason };
    }

    const ext = path.extname(downloadedPath).toLowerCase();
    const mimeType =
      ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';

    onProgress?.(96, 'Video listo, cargando en el editor...');

    return {
      ok: true,
      filePath: downloadedPath,
      title: printedTitle || `Video_${Date.now()}`,
      extractor: (printedExtractor || 'ytdlp').toLowerCase(),
      mimeType,
      cleanup,
    };
  } catch (err) {
    await cleanup();
    const rawMsg = err instanceof Error ? err.message : 'Error ejecutando yt-dlp.';
    return {
      ok: false,
      reason: rawMsg,
    };
  }
}

async function streamYtDlpResult(
  res: Response,
  result: YtDlpResult,
  sourceLabel?: string,
  savedPcPath?: string
) {
  try {
    const stat = await fs.promises.stat(result.filePath);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('X-Video-Title', encodeURIComponent(result.title));
    res.setHeader('X-Video-Source', sourceLabel || `ytdlp-${result.extractor}`);
    if (savedPcPath) {
      res.setHeader('X-Saved-Pc-Path', encodeURIComponent(savedPcPath));
    }
    await pipeline(fs.createReadStream(result.filePath), res);
  } finally {
    await result.cleanup();
  }
}

function getClientUserAgent(client: ClientCandidate): string {
  if (client === 'IOS') return IOS_UA;
  if (client === 'ANDROID' || client === 'ANDROID_VR') return ANDROID_UA;
  return BROWSER_UA;
}

async function downloadStreamToFile(url: string, destPath: string, userAgent: string): Promise<void> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      Accept: '*/*',
      Referer: 'https://www.youtube.com/',
    },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} al descargar flujo`);
  }
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_VIDEO_BYTES) {
    throw new Error('El video supera el límite de 450 MB.');
  }
  const nodeStream = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream);
  await pipeline(nodeStream, fs.createWriteStream(destPath));
}

async function handleYouTubeImport(res: Response, rawUrl: string, videoId: string) {
  const oembedPromise = fetchYouTubeOEmbed(videoId);

  // 1. Primary local extractor: yt-dlp (IPv4 + deno JS runtime, zero env vars)
  let ytDlpAttempt = IS_WINDOWS
    ? await runYtDlpDownload(rawUrl, ['-4'])
    : await runYtDlpDownload(rawUrl, [
        '-4',
        '--extractor-args',
        'youtube:player_client=tv_simply,android_vr,ios,web',
      ]);

  if (!ytDlpAttempt.ok && IS_WINDOWS) {
    ytDlpAttempt = await runYtDlpDownload(rawUrl, [
      '-4',
      '--extractor-args',
      'youtube:player_client=tv_simply,android_vr,ios,web',
    ]);
  }

  if (ytDlpAttempt.ok) {
    const oembed = await oembedPromise;
    if (!ytDlpAttempt.title || ytDlpAttempt.title.startsWith('Video_')) {
      ytDlpAttempt.title = oembed.title;
    }
    await streamYtDlpResult(res, ytDlpAttempt, 'ytdlp-youtube');
    return;
  }

  let lastReason = ytDlpAttempt.reason;

  // 2. Secondary fallback via youtubei.js
  const clients: ClientCandidate[] = ['IOS', 'ANDROID_VR', 'ANDROID', 'TV', 'WEB'];
  const oembed = await oembedPromise;

  try {
    const yt = await Innertube.create({ generate_session_locally: true });

    for (const client of clients) {
      try {
        const info = await yt.getBasicInfo(videoId, { client });
        const playStatus = info.playability_status?.status;
        if (playStatus && playStatus !== 'OK') {
          lastReason = info.playability_status?.reason || lastReason;
          continue;
        }

        const muxed = (info.streaming_data?.formats || []).filter(
          (f) => f.has_video && f.has_audio && f.mime_type?.includes('mp4')
        );
        muxed.sort((a, b) => (b.height || 0) - (a.height || 0));
        const bestMuxed = muxed.find((f) => (f.height || 0) <= 720) || muxed[0];
        const ua = getClientUserAgent(client);

        if (bestMuxed) {
          const streamUrl = await bestMuxed.decipher(yt.session.player);
          if (streamUrl) {
            const upstream = await fetch(streamUrl, {
              headers: {
                'User-Agent': ua,
                Referer: 'https://www.youtube.com/',
              },
              signal: AbortSignal.timeout(60000),
            });
            if (upstream.ok && upstream.body) {
              res.setHeader('Content-Type', 'video/mp4');
              res.setHeader('X-Video-Title', encodeURIComponent(oembed.title));
              res.setHeader('X-Video-Source', `youtube-${client.toLowerCase()}`);
              const len = upstream.headers.get('content-length');
              if (len) res.setHeader('Content-Length', len);

              const nodeStream = Readable.fromWeb(
                upstream.body as unknown as import('node:stream/web').ReadableStream
              );
              await pipeline(nodeStream, res);
              return;
            }
          }
        }

        const adaptive = info.streaming_data?.adaptive_formats || [];
        const videoFormats = adaptive
          .filter(
            (f) =>
              f.has_video &&
              !f.has_audio &&
              (f.mime_type?.includes('video/mp4') || f.mime_type?.includes('avc1'))
          )
          .sort((a, b) => (b.height || 0) - (a.height || 0));
        const bestVideo = videoFormats.find((f) => (f.height || 0) <= 1080) || videoFormats[0];

        const audioFormats = adaptive
          .filter((f) => f.has_audio && !f.has_video && f.mime_type?.includes('audio/mp4'))
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        const bestAudio = audioFormats[0];

        if (bestVideo && bestAudio) {
          const videoUrl = await bestVideo.decipher(yt.session.player);
          const audioUrl = await bestAudio.decipher(yt.session.player);
          if (videoUrl && audioUrl) {
            const stamp = `${videoId}_${Date.now()}`;
            const tmpVideo = path.join(os.tmpdir(), `yt_v_${stamp}.mp4`);
            const tmpAudio = path.join(os.tmpdir(), `yt_a_${stamp}.m4a`);
            const tmpOut = path.join(os.tmpdir(), `yt_out_${stamp}.mp4`);
            try {
              await Promise.all([
                downloadStreamToFile(videoUrl, tmpVideo, ua),
                downloadStreamToFile(audioUrl, tmpAudio, ua),
              ]);
              const ffmpegBin = await ensureFfmpeg();
              await execFileAsync(ffmpegBin, [
                '-y',
                '-i',
                tmpVideo,
                '-i',
                tmpAudio,
                '-c',
                'copy',
                '-movflags',
                '+faststart',
                tmpOut,
              ]);
              const stat = fs.statSync(tmpOut);
              if (stat.size > MAX_VIDEO_BYTES) {
                throw new Error('El video excede el límite de 450 MB.');
              }
              res.setHeader('Content-Type', 'video/mp4');
              res.setHeader('Content-Length', String(stat.size));
              res.setHeader('X-Video-Title', encodeURIComponent(oembed.title));
              res.setHeader('X-Video-Source', `youtube-${client.toLowerCase()}-mux`);
              await pipeline(fs.createReadStream(tmpOut), res);
              return;
            } finally {
              [tmpVideo, tmpAudio, tmpOut].forEach((p) => {
                try {
                  if (fs.existsSync(p)) fs.unlinkSync(p);
                } catch {
                  // ignore
                }
              });
            }
          }
        }
      } catch (err) {
        if (!lastReason && err instanceof Error) {
          lastReason = err.message;
        }
      }
    }
  } catch {
    // preserve yt-dlp reason
  }

  if (!res.headersSent) {
    res.status(422).json({
      code: 'YOUTUBE_BOT_BLOCK',
      videoId,
      title: oembed.title,
      author: oembed.author,
      thumbnailUrl: oembed.thumbnailUrl,
      embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0&playsinline=1`,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      reason: lastReason,
    });
  }
}

async function fetchDirectOrYtDlpProxy(
  res: Response,
  rawUrl: string,
  depth = 0
): Promise<void> {
  if (depth > 2) {
    res.status(422).json({ error: 'No se encontró un archivo de video reproducible en esa URL.' });
    return;
  }

  const targetUrl = normalizeDirectVideoUrl(rawUrl);
  const check = validateExternalUrl(targetUrl);
  if (!check.ok) {
    res.status(check.status).json({ error: check.error });
    return;
  }
  const parsed = check.url;

  const host = parsed.hostname.toLowerCase();
  const isLikelyDirectMedia = /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(parsed.pathname);

  if (!isLikelyDirectMedia) {
    const ytDlpResult = await runYtDlpDownload(targetUrl);
    if (ytDlpResult.ok) {
      await streamYtDlpResult(res, ytDlpResult);
      return;
    }
  }

  const upstream = await fetch(targetUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
      Referer: parsed.origin,
    },
    signal: AbortSignal.timeout(45000),
  });

  if (!upstream.ok || !upstream.body) {
    res.status(422).json({
      error: `El servidor remoto (${host}) respondió con estado ${upstream.status}.`,
    });
    return;
  }

  const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
    const html = await upstream.text();
    const ogMatch =
      html.match(/<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url|:url)?["']/i) ||
      html.match(/<video[^>]+src=["']([^"']+)["']/i) ||
      html.match(/<source[^>]+src=["']([^"']+)["']/i);

    if (ogMatch && ogMatch[1]) {
      const resolved = new URL(ogMatch[1], parsed.href).toString();
      await fetchDirectOrYtDlpProxy(res, resolved, depth + 1);
      return;
    }

    res.status(422).json({
      error:
        'La URL devolvió una página web y yt-dlp no encontró un flujo de video descargable público.',
    });
    return;
  }

  const len = Number(upstream.headers.get('content-length') || 0);
  if (len > MAX_VIDEO_BYTES) {
    res.status(413).json({ error: 'El video supera el límite de 450 MB.' });
    return;
  }

  const mime =
    contentType.startsWith('video/') || contentType.startsWith('application/octet-stream')
      ? contentType.split(';')[0]
      : 'video/mp4';

  const fileName = parsed.pathname.split('/').pop() || `video_${Date.now()}.mp4`;
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Video-Title', encodeURIComponent(fileName));
  res.setHeader('X-Video-Source', 'direct-proxy');
  if (len > 0) res.setHeader('Content-Length', String(len));

  const nodeStream = Readable.fromWeb(
    upstream.body as unknown as import('node:stream/web').ReadableStream
  );
  await pipeline(nodeStream, res);
}

export interface StartServerOptions {
  port?: number;
  host?: string;
  distDir?: string;
  binDir?: string;
  mediaDir?: string;
  // C1: token de la API local. Si no se pasa, se usa la variable de
  // entorno SHORTSTUDIO_API_TOKEN o se genera uno aleatorio por proceso.
  apiToken?: string;
}

function sanitizeDownloadFilename(rawTitle: string): string {
  const cleaned = String(rawTitle || 'ShortStudio_Video')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return cleaned || `ShortStudio_${Date.now()}`;
}

async function copyDownloadToPcFolder(
  sourceFilePath: string,
  rawTitle: string,
  mimeType: string
): Promise<string | undefined> {
  if (!IS_WINDOWS) return undefined;
  try {
    const ext = mimeType.includes('webm')
      ? '.webm'
      : mimeType.includes('quicktime')
      ? '.mov'
      : '.mp4';
    const baseDir = path.join(os.homedir(), 'Downloads', 'ShortStudio');
    await fs.promises.mkdir(baseDir, { recursive: true });
    const safeTitle = sanitizeDownloadFilename(rawTitle);
    const hasExt = /\.(mp4|webm|mov|m4v)$/i.test(safeTitle);
    let destPath = path.join(baseDir, hasExt ? safeTitle : `${safeTitle}${ext}`);
    if (fs.existsSync(destPath)) {
      const stem = hasExt ? safeTitle.replace(/\.[^/.]+$/, '') : safeTitle;
      destPath = path.join(baseDir, `${stem}_${Date.now().toString().slice(-4)}${ext}`);
    }
    await fs.promises.copyFile(sourceFilePath, destPath);
    return destPath;
  } catch {
    return undefined;
  }
}

export async function startServer(options: StartServerOptions = {}) {
  if (options.binDir) {
    activeBinDir = options.binDir;
  }
  if (options.mediaDir) {
    activeMediaDir = options.mediaDir;
    fs.mkdirSync(activeMediaDir, { recursive: true });
  }

  void cleanupOrphanedTempFiles();

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // --- C1 (auditoría): autenticación por token de la API local --------
  // Antes ningún endpoint comprobaba credenciales y el servidor podía
  // quedar expuesto a toda la red local. Ahora:
  //  - Se genera un token aleatorio por proceso (o lo fija quien arranca
  //    el servidor con options.apiToken / SHORTSTUDIO_API_TOKEN).
  //  - El frontend lo sirve ESTE mismo servidor (mismo origen), así que
  //    el token se entrega al navegador como cookie HttpOnly al cargar
  //    la página y el navegador lo reenvía automáticamente en cada
  //    petición /api/*, incluidos los <video src="/api/local-media/...">
  //    que no pueden enviar cabeceras personalizadas.
  //  - Los clientes que no son navegador pueden enviar el token en la
  //    cabecera X-ShortStudio-Token, como ya hace el conector de Windows.
  const apiToken =
    options.apiToken ||
    process.env.SHORTSTUDIO_API_TOKEN ||
    crypto.randomBytes(32).toString('hex');
  const apiTokenBuffer = Buffer.from(apiToken, 'utf8');
  const hasValidApiToken = (candidate: string | undefined): boolean => {
    if (!candidate) return false;
    const buf = Buffer.from(candidate, 'utf8');
    return buf.length === apiTokenBuffer.length && crypto.timingSafeEqual(buf, apiTokenBuffer);
  };
  const readCookie = (req: Request, name: string): string | undefined => {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) {
        try {
          return decodeURIComponent(part.slice(eq + 1).trim());
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  };

  // Entrega del token: las respuestas que no son de la API (la página y
  // sus recursos) fijan o renuevan la cookie con el token vigente, para
  // que un reinicio del servidor no deje al navegador con un token viejo.
  app.use((req: Request, res: Response, next: () => void) => {
    if (!req.path.startsWith('/api')) {
      res.setHeader(
        'Set-Cookie',
        `${API_TOKEN_COOKIE}=${encodeURIComponent(apiToken)}; HttpOnly; SameSite=Strict; Path=/`
      );
    }
    next();
  });

  // Validación: todas las rutas /api/* exigen el token, salvo el health
  // check, que no expone datos ni permite ninguna acción.
  app.use('/api', (req: Request, res: Response, next: () => void) => {
    if (req.path === '/health' && req.method === 'GET') {
      next();
      return;
    }
    const headerValue = req.headers[API_TOKEN_HEADER];
    const candidate =
      (Array.isArray(headerValue) ? headerValue[0] : headerValue) ||
      readCookie(req, API_TOKEN_COOKIE);
    if (hasValidApiToken(candidate)) {
      next();
      return;
    }
    res.status(401).json({
      error: 'No autorizado: falta el token de la API local de ShortStudio.',
    });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      platform: process.platform,
      desktopMediaEnabled: Boolean(activeMediaDir),
      developer: 'Kelly Benjamin De La Cruz',
    });
  });

  // Persistent Desktop local media storage (supports >250 MB videos without IDB/RAM bloat)
  const resolveLocalMediaPaths = (rawId: string) => {
    if (!activeMediaDir || !/^[a-zA-Z0-9_-]{4,80}$/.test(rawId)) return null;
    const root = path.resolve(activeMediaDir);
    const binPath = path.resolve(root, `${rawId}.bin`);
    const metaPath = path.resolve(root, `${rawId}.json`);
    if (!binPath.startsWith(root + path.sep) || !metaPath.startsWith(root + path.sep)) {
      return null;
    }
    return { binPath, metaPath };
  };

  app.post('/api/local-media/:mediaId', async (req: Request, res: Response) => {
    const paths = resolveLocalMediaPaths(String(req.params.mediaId || ''));
    if (!paths) {
      res.status(404).json({ error: 'Almacenamiento local de escritorio no disponible.' });
      return;
    }
    // A3 (auditoría): la subida cuenta los bytes en streaming y se
    // aborta al superar el mismo tope que usan el resto de endpoints;
    // antes se volcaba a disco sin ningún límite y podía llenarlo.
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (declaredLength > MAX_VIDEO_BYTES) {
      res.status(413).json({
        error: `El archivo supera el límite de ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB.`,
      });
      return;
    }
    const tmpPath = `${paths.binPath}.part`;
    let receivedBytes = 0;
    let limitExceeded = false;
    const countingStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_VIDEO_BYTES) {
          limitExceeded = true;
          callback(
            new Error(
              `El archivo supera el límite de ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB.`
            )
          );
          return;
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(req, countingStream, fs.createWriteStream(tmpPath));
      if (fs.existsSync(paths.binPath)) {
        await fs.promises.unlink(paths.binPath).catch(() => {});
      }
      await fs.promises.rename(tmpPath, paths.binPath);
      const rawName = String(req.headers['x-media-name'] || '');
      const name = rawName ? decodeURIComponent(rawName) : `${req.params.mediaId}.mp4`;
      const mimeType = String(req.headers['content-type'] || 'video/mp4').split(';')[0];
      await fs.promises.writeFile(
        paths.metaPath,
        JSON.stringify({ name, mimeType, createdAt: new Date().toISOString() }),
        'utf8'
      );
      res.json({ ok: true });
    } catch (err) {
      // El parcial siempre se borra, también cuando se aborta por tamaño.
      await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
      if (limitExceeded) {
        res.status(413).json({
          error: `El archivo supera el límite de ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB.`,
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Error guardando video en disco.',
      });
    }
  });

  app.head('/api/local-media/:mediaId', async (req: Request, res: Response) => {
    const paths = resolveLocalMediaPaths(String(req.params.mediaId || ''));
    if (!paths || !fs.existsSync(paths.binPath)) {
      res.status(404).end();
      return;
    }
    try {
      const stat = await fs.promises.stat(paths.binPath);
      let mimeType = 'video/mp4';
      let name = '';
      if (fs.existsSync(paths.metaPath)) {
        const meta = JSON.parse(await fs.promises.readFile(paths.metaPath, 'utf8')) as {
          mimeType?: string;
          name?: string;
        };
        if (meta.mimeType) mimeType = meta.mimeType;
        if (meta.name) name = meta.name;
      }
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Accept-Ranges', 'bytes');
      if (name) res.setHeader('X-Media-Name', encodeURIComponent(name));
      res.status(200).end();
    } catch {
      res.status(404).end();
    }
  });

  app.get('/api/local-media/:mediaId', async (req: Request, res: Response) => {
    const paths = resolveLocalMediaPaths(String(req.params.mediaId || ''));
    if (!paths || !fs.existsSync(paths.binPath)) {
      res.status(404).json({ error: 'Video local no encontrado en disco.' });
      return;
    }
    try {
      const stat = await fs.promises.stat(paths.binPath);
      let mimeType = 'video/mp4';
      if (fs.existsSync(paths.metaPath)) {
        const meta = JSON.parse(await fs.promises.readFile(paths.metaPath, 'utf8')) as {
          mimeType?: string;
        };
        if (meta.mimeType) mimeType = meta.mimeType;
      }

      const range = req.headers.range;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', mimeType);

      if (range) {
        const match = range.match(/bytes=(\d*)-(\d*)/);
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0;
          const end = match[2] ? Math.min(stat.size - 1, parseInt(match[2], 10)) : stat.size - 1;
          if (start >= stat.size || end < start) {
            res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
            return;
          }
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', String(end - start + 1));
          await pipeline(fs.createReadStream(paths.binPath, { start, end }), res).catch(() => {});
          return;
        }
      }

      res.setHeader('Content-Length', String(stat.size));
      await pipeline(fs.createReadStream(paths.binPath), res).catch(() => {});
    } catch {
      if (!res.headersSent) res.status(500).end();
    }
  });

  app.delete('/api/local-media/:mediaId', async (req: Request, res: Response) => {
    const paths = resolveLocalMediaPaths(String(req.params.mediaId || ''));
    if (!paths) {
      res.status(404).json({ ok: false });
      return;
    }
    await Promise.all([
      fs.promises.rm(paths.binPath, { force: true }).catch(() => {}),
      fs.promises.rm(paths.metaPath, { force: true }).catch(() => {}),
      fs.promises.rm(`${paths.binPath}.part`, { force: true }).catch(() => {}),
    ]);
    res.json({ ok: true });
  });

  app.delete('/api/local-media', async (_req: Request, res: Response) => {
    if (!activeMediaDir) {
      res.json({ ok: false });
      return;
    }
    try {
      const entries = await fs.promises.readdir(activeMediaDir);
      await Promise.all(
        entries.map((name) =>
          fs.promises.rm(path.join(activeMediaDir!, name), { recursive: true, force: true }).catch(() => {})
        )
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false });
    }
  });

  const extractAudioPeaksFromFile = async (
    ffmpegBin: string,
    inputPath: string,
    numBins = 360
  ): Promise<{
    durationSec: number;
    peaks: number[];
    energy20Hz: number[];
    sampleRateHz: number;
  }> => {
    const safeBins = Math.max(40, Math.min(720, Math.round(numBins || 360)));
    const SAMPLE_RATE = 8000;
    const TARGET_HZ = 20;
    const SAMPLES_PER_FRAME = SAMPLE_RATE / TARGET_HZ; // 400 samples = 50ms
    const BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2; // 800 bytes (s16le)

    const energy20Hz: number[] = [];
    const raw50msPeaks: number[] = [];
    let totalSamples = 0;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        ffmpegBin,
        ['-v', 'error', '-i', inputPath, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

      let pending: Buffer = Buffer.alloc(0);
      let stderrText = '';
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(new Error('Tiempo agotado extrayendo perfil de audio.'));
      }, 120_000);

      proc.stdout.on('data', (chunk: Buffer) => {
        pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
        let offset = 0;
        while (offset + BYTES_PER_FRAME <= pending.length) {
          let sumSq = 0;
          let maxAbs = 0;
          for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
            const sample = pending.readInt16LE(offset + i * 2) / 32768;
            sumSq += sample * sample;
            const abs = Math.abs(sample);
            if (abs > maxAbs) maxAbs = abs;
          }
          const rms = Math.sqrt(sumSq / SAMPLES_PER_FRAME);
          if (energy20Hz.length < 144_000) {
            energy20Hz.push(Math.min(255, Math.round(rms * 255 * 1.45)));
            raw50msPeaks.push(Math.min(1, maxAbs));
          }
          totalSamples += SAMPLES_PER_FRAME;
          offset += BYTES_PER_FRAME;
        }
        if (offset > 0) {
          pending = pending.subarray(offset);
        }
      });

      proc.stderr.on('data', (d: Buffer) => {
        if (stderrText.length < 2000) stderrText += d.toString('utf8');
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (pending.length >= 4) {
          const remSamples = Math.floor(pending.length / 2);
          let sumSq = 0;
          let maxAbs = 0;
          for (let i = 0; i < remSamples; i++) {
            const sample = pending.readInt16LE(i * 2) / 32768;
            sumSq += sample * sample;
            const abs = Math.abs(sample);
            if (abs > maxAbs) maxAbs = abs;
          }
          if (energy20Hz.length < 144_000) {
            energy20Hz.push(Math.min(255, Math.round(Math.sqrt(sumSq / remSamples) * 255 * 1.45)));
            raw50msPeaks.push(Math.min(1, maxAbs));
          }
          totalSamples += remSamples;
        }

        // Videos without audio stream yield empty output; return silent profile gracefully
        if (code !== 0 && totalSamples === 0) {
          resolve();
          return;
        }
        resolve();
      });
    });

    if (raw50msPeaks.length === 0) {
      return { durationSec: 0, peaks: [], energy20Hz: [], sampleRateHz: TARGET_HZ };
    }

    const peaks: number[] = [];
    for (let b = 0; b < safeBins; b++) {
      const s = Math.floor((b / safeBins) * raw50msPeaks.length);
      const e = Math.max(s + 1, Math.floor(((b + 1) / safeBins) * raw50msPeaks.length));
      let pk = 0;
      for (let k = s; k < e; k++) {
        if (raw50msPeaks[k] > pk) pk = raw50msPeaks[k];
      }
      peaks.push(Number(pk.toFixed(3)));
    }

    return {
      durationSec: Number((totalSamples / SAMPLE_RATE).toFixed(2)),
      peaks,
      energy20Hz,
      sampleRateHz: TARGET_HZ,
    };
  };

  app.post('/api/audio-peaks', async (req: Request, res: Response) => {
    const body = (req.body || {}) as { mediaId?: string; numBins?: number };
    const mediaId = String(body.mediaId || '').trim();
    const paths = resolveLocalMediaPaths(mediaId);
    if (!paths || !fs.existsSync(paths.binPath)) {
      res.status(404).json({ error: 'Video local no encontrado en disco.' });
      return;
    }

    try {
      const ffmpegBin = await ensureFfmpeg();
      const result = await extractAudioPeaksFromFile(ffmpegBin, paths.binPath, body.numBins);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? `Error analizando onda de audio: ${err.message}`
            : 'No se pudo analizar la onda de audio.',
      });
    }
  });

  interface ImportUrlJob {
    id: string;
    status: 'running' | 'ready' | 'blocked' | 'error' | 'canceled';
    percent: number;
    label: string;
    saveToPc: boolean;
    savedPcPath?: string;
    abortController: AbortController;
    activeChild?: ChildProcess | null;
    result?: YtDlpResult;
    blocked?: {
      code: 'YOUTUBE_BOT_BLOCK';
      videoId: string;
      title: string;
      author: string;
      thumbnailUrl: string;
      embedUrl: string;
      watchUrl: string;
      reason: string;
    };
    error?: string;
  }

  const importUrlJobs = new Map<string, ImportUrlJob>();

  const scheduleImportJobCleanup = (jobId: string) => {
    setTimeout(() => {
      const existing = importUrlJobs.get(jobId);
      if (existing) {
        if (existing.result) {
          void existing.result.cleanup();
        }
        importUrlJobs.delete(jobId);
      }
    }, 10 * 60 * 1000).unref();
  };

  const runDirectDownloadToTemp = async (
    targetUrl: string,
    onProgress: (pct: number, label: string) => void,
    control?: YtDlpControl,
    depth = 0
  ): Promise<{ ok: true; result: YtDlpResult } | { ok: false; error: string }> => {
    if (control?.signal?.aborted) {
      return { ok: false, error: 'Descarga cancelada por el usuario.' };
    }
    if (depth > 2) {
      return { ok: false, error: 'No se encontró un archivo de video reproducible en esa URL.' };
    }
    const normalized = normalizeDirectVideoUrl(targetUrl);
    const check = validateExternalUrl(normalized);
    if (!check.ok) {
      return { ok: false, error: check.error };
    }
    const parsed = check.url;
    const isLikelyDirectMedia = /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(parsed.pathname);

    if (!isLikelyDirectMedia) {
      const ytDlpResult = await runYtDlpDownload(normalized, [], onProgress, control);
      if (control?.signal?.aborted) {
        if (ytDlpResult.ok) await ytDlpResult.cleanup();
        return { ok: false, error: 'Descarga cancelada por el usuario.' };
      }
      if (ytDlpResult.ok) {
        return { ok: true, result: ytDlpResult };
      }
    }

    onProgress(12, 'Conectando con servidor remoto...');
    const timeoutSig = AbortSignal.timeout(45000);
    const fetchSig = control?.signal
      ? AbortSignal.any([control.signal, timeoutSig])
      : timeoutSig;
    const upstream = await fetch(normalized, {
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
        Referer: parsed.origin,
      },
      signal: fetchSig,
    });

    if (!upstream.ok || !upstream.body) {
      return {
        ok: false,
        error: `El servidor remoto (${parsed.hostname}) respondió con estado ${upstream.status}.`,
      };
    }

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      const html = await upstream.text();
      const ogMatch =
        html.match(/<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url|:url)?["']/i) ||
        html.match(/<video[^>]+src=["']([^"']+)["']/i) ||
        html.match(/<source[^>]+src=["']([^"']+)["']/i);
      if (ogMatch && ogMatch[1]) {
        const resolved = new URL(ogMatch[1], parsed.href).toString();
        return runDirectDownloadToTemp(resolved, onProgress, control, depth + 1);
      }
      return {
        ok: false,
        error: 'La URL devolvió una página web y yt-dlp no encontró un flujo de video descargable público.',
      };
    }

    const totalBytes = Number(upstream.headers.get('content-length') || 0);
    if (totalBytes > MAX_VIDEO_BYTES) {
      return { ok: false, error: 'El video supera el límite de 450 MB.' };
    }

    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'direct_ss_'));
    const cleanup = async () => {
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    };

    const fileName = parsed.pathname.split('/').pop() || `video_${Date.now()}.mp4`;
    const filePath = path.join(workDir, 'clip.mp4');

    try {
      const reader = upstream.body.getReader();
      const out = fs.createWriteStream(filePath);
      let loaded = 0;

      await new Promise<void>((resolve, reject) => {
        out.on('error', reject);
        (async () => {
          try {
            while (true) {
              if (control?.signal?.aborted) {
                throw new Error('Descarga cancelada por el usuario.');
              }
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.byteLength > 0) {
                loaded += value.byteLength;
                if (loaded > MAX_VIDEO_BYTES) {
                  throw new Error('El video supera el límite de 450 MB.');
                }
                if (!out.write(Buffer.from(value))) {
                  await new Promise<void>((r) => out.once('drain', r));
                }
                if (totalBytes > 0) {
                  const pct = Math.min(95, Math.max(12, Math.round(12 + (loaded / totalBytes) * 83)));
                  onProgress(
                    pct,
                    `Descargando MP4... ${pct}% (${(loaded / (1024 * 1024)).toFixed(1)} MB)`
                  );
                } else {
                  const pseudo = Math.min(90, 15 + Math.round((loaded / (1024 * 1024)) * 2));
                  onProgress(
                    pseudo,
                    `Descargando MP4... ${(loaded / (1024 * 1024)).toFixed(1)} MB`
                  );
                }
              }
            }
            out.end(resolve);
          } catch (err) {
            reader.cancel().catch(() => {});
            out.destroy();
            reject(err);
          }
        })();
      });

      const mimeType =
        contentType.startsWith('video/') || contentType.startsWith('application/octet-stream')
          ? contentType.split(';')[0]
          : 'video/mp4';

      onProgress(96, 'Video listo, cargando en el editor...');
      return {
        ok: true,
        result: {
          ok: true,
          filePath,
          title: fileName,
          extractor: 'direct-proxy',
          mimeType,
          cleanup,
        },
      };
    } catch (err) {
      await cleanup();
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Error descargando el archivo remoto.',
      };
    }
  };

  app.post('/api/import-url/start', (req: Request, res: Response) => {
    const body = (req.body || {}) as { url?: string; saveToPc?: boolean };
    const rawUrl = (body.url || '').trim();
    if (!rawUrl) {
      res.status(400).json({ error: 'Ingresa una URL válida.' });
      return;
    }

    const check = validateExternalUrl(rawUrl);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }

    const jobId = crypto.randomBytes(12).toString('hex');
    const abortController = new AbortController();
    const job: ImportUrlJob = {
      id: jobId,
      status: 'running',
      percent: 2,
      label: 'Iniciando descarga...',
      saveToPc: Boolean(body.saveToPc),
      abortController,
      activeChild: null,
    };
    importUrlJobs.set(jobId, job);
    scheduleImportJobCleanup(jobId);

    const updateJob = (pct: number, label: string) => {
      if (job.status !== 'running') return;
      job.percent = Math.max(job.percent, Math.min(98, Math.round(pct)));
      job.label = label;
    };

    const dlControl: YtDlpControl = {
      signal: abortController.signal,
      onSpawn: (child) => {
        job.activeChild = child;
      },
    };

    const isJobCanceled = () => abortController.signal.aborted || (job.status as string) === 'canceled';

    (async () => {
      try {
        const ytId = extractYouTubeId(rawUrl);
        if (ytId) {
          const oembedPromise = fetchYouTubeOEmbed(ytId);
          let attempt = IS_WINDOWS
            ? await runYtDlpDownload(rawUrl, ['-4'], updateJob, dlControl)
            : await runYtDlpDownload(
                rawUrl,
                ['-4', '--extractor-args', 'youtube:player_client=tv_simply,android_vr,ios,web'],
                updateJob,
                dlControl
              );

          if (isJobCanceled()) {
            if (attempt.ok) await attempt.cleanup();
            return;
          }

          if (!attempt.ok && IS_WINDOWS) {
            updateJob(10, 'Reintentando con cliente alternativo...');
            attempt = await runYtDlpDownload(
              rawUrl,
              ['-4', '--extractor-args', 'youtube:player_client=tv_simply,android_vr,ios,web'],
              updateJob,
              dlControl
            );
          }

          if (isJobCanceled()) {
            if (attempt.ok) await attempt.cleanup();
            return;
          }

          const oembed = await oembedPromise;
          if (attempt.ok) {
            if (!attempt.title || attempt.title.startsWith('Video_')) {
              attempt.title = oembed.title;
            }
            if (job.saveToPc) {
              job.savedPcPath = await copyDownloadToPcFolder(
                attempt.filePath,
                attempt.title,
                attempt.mimeType
              );
            }
            job.result = attempt;
            job.percent = 96;
            job.label = 'Descarga completada, cargando en el editor...';
            job.status = 'ready';
            return;
          }

          job.status = 'blocked';
          job.blocked = {
            code: 'YOUTUBE_BOT_BLOCK',
            videoId: ytId,
            title: oembed.title,
            author: oembed.author,
            thumbnailUrl: oembed.thumbnailUrl,
            embedUrl: `https://www.youtube.com/embed/${ytId}?rel=0&playsinline=1`,
            watchUrl: `https://www.youtube.com/watch?v=${ytId}`,
            reason: attempt.reason,
          };
          return;
        }

        const direct = await runDirectDownloadToTemp(rawUrl, updateJob, dlControl);
        if (isJobCanceled()) {
          if (direct.ok) await direct.result.cleanup();
          return;
        }
        if (direct.ok) {
          if (job.saveToPc) {
            job.savedPcPath = await copyDownloadToPcFolder(
              direct.result.filePath,
              direct.result.title,
              direct.result.mimeType
            );
          }
          job.result = direct.result;
          job.percent = 96;
          job.label = 'Descarga completada, cargando en el editor...';
          job.status = 'ready';
        } else {
          job.status = 'error';
          job.error = direct.error;
        }
      } catch (err) {
        if (job.status === 'canceled' || abortController.signal.aborted) return;
        job.status = 'error';
        job.error =
          err instanceof Error
            ? err.message
            : 'Error interno al importar el video desde la URL.';
      }
    })();

    res.json({ jobId });
  });

  app.post('/api/import-url/:jobId/cancel', (req: Request, res: Response) => {
    const jobId = String(req.params.jobId || '');
    const job = importUrlJobs.get(jobId);
    if (!job) {
      res.status(404).json({ ok: false });
      return;
    }
    job.status = 'canceled';
    job.label = 'Descarga cancelada';
    job.abortController.abort();
    if (job.activeChild) {
      try {
        job.activeChild.kill('SIGTERM');
      } catch {
        // ignore
      }
      job.activeChild = null;
    }
    if (job.result) {
      void job.result.cleanup();
      job.result = undefined;
    }
    res.json({ ok: true });
  });

  app.get('/api/import-url/:jobId/status', (req: Request, res: Response) => {
    const job = importUrlJobs.get(String(req.params.jobId || ''));
    if (!job) {
      res.status(404).json({ error: 'Trabajo de descarga no encontrado.' });
      return;
    }
    res.json({
      status: job.status,
      percent: job.percent,
      label: job.label,
      savedPcPath: job.savedPcPath,
      blocked: job.blocked,
      error: job.error,
    });
  });

  app.get('/api/import-url/:jobId/file', async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId || '');
    const job = importUrlJobs.get(jobId);
    if (!job || job.status !== 'ready' || !job.result) {
      res.status(404).json({ error: 'Archivo aún no disponible o expirado.' });
      return;
    }
    const result = job.result;
    const savedPcPath = job.savedPcPath;
    importUrlJobs.delete(jobId);
    await streamYtDlpResult(res, result, `ytdlp-${result.extractor}`, savedPcPath);
  });

  app.post('/api/import-url', async (req: Request, res: Response) => {
    const body = (req.body || {}) as { url?: string };
    const rawUrl = (body.url || '').trim();
    if (!rawUrl) {
      res.status(400).json({ error: 'Ingresa una URL válida.' });
      return;
    }

    const check = validateExternalUrl(rawUrl);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }

    try {
      const ytId = extractYouTubeId(rawUrl);
      if (ytId) {
        await handleYouTubeImport(res, rawUrl, ytId);
        return;
      }
      await fetchDirectOrYtDlpProxy(res, rawUrl);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error:
            err instanceof Error
              ? err.message
              : 'Error interno al importar el video desde la URL.',
        });
      }
    }
  });

  const mediaJobsRoot = path.resolve(os.tmpdir(), 'ss_media_jobs');
  fs.mkdirSync(mediaJobsRoot, { recursive: true });

  const resolveSafeJobDir = (rawJobId: string): string | null => {
    if (!/^[a-f0-9]{24}$/.test(rawJobId)) return null;
    const resolved = path.resolve(mediaJobsRoot, rawJobId);
    if (!resolved.startsWith(mediaJobsRoot + path.sep)) return null;
    if (!fs.existsSync(resolved)) return null;
    return resolved;
  };

  const cleanupJobDir = async (dirPath: string) => {
    try {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  app.post('/api/media-job/init', async (_req: Request, res: Response) => {
    try {
      const jobId = crypto.randomBytes(12).toString('hex');
      const jobDir = path.resolve(mediaJobsRoot, jobId);
      await fs.promises.mkdir(jobDir, { recursive: true });
      setTimeout(() => {
        void cleanupJobDir(jobDir);
      }, 15 * 60 * 1000).unref();
      res.json({ jobId });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'No se pudo iniciar la sesión de exportación.',
      });
    }
  });

  app.post(
    '/api/media-job/:jobId/append',
    express.raw({ type: '*/*', limit: '20mb' }),
    async (req: Request, res: Response) => {
      const jobDir = resolveSafeJobDir(String(req.params.jobId || ''));
      if (!jobDir) {
        res.status(404).json({ error: 'Sesión de exportación inválida o expirada.' });
        return;
      }

      const part = req.query.part === 'audio' ? 'audio' : req.query.part === 'video' ? 'video' : null;
      if (!part) {
        res.status(400).json({ error: 'Parámetro part inválido.' });
        return;
      }

      const buf = req.body as Buffer | undefined;
      if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ error: 'Fragmento vacío.' });
        return;
      }

      const targetFile = path.resolve(jobDir, `${part}.bin`);
      if (!targetFile.startsWith(jobDir + path.sep)) {
        res.status(400).json({ error: 'Ruta inválida.' });
        return;
      }

      try {
        let currentBytes = 0;
        for (const name of ['video.bin', 'audio.bin']) {
          const p = path.resolve(jobDir, name);
          if (fs.existsSync(p)) {
            currentBytes += fs.statSync(p).size;
          }
        }
        if (currentBytes + buf.length > MAX_VIDEO_BYTES) {
          res.status(413).json({ error: 'El archivo excede el límite de 450 MB.' });
          return;
        }
        await fs.promises.appendFile(targetFile, buf);
        res.json({ ok: true, bytes: buf.length });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Error escribiendo fragmento.',
        });
      }
    }
  );

  app.post('/api/media-job/:jobId/mux', async (req: Request, res: Response) => {
    const jobDir = resolveSafeJobDir(String(req.params.jobId || ''));
    if (!jobDir) {
      res.status(404).json({ error: 'Sesión de exportación inválida o expirada.' });
      return;
    }

    const videoPath = path.resolve(jobDir, 'video.bin');
    const audioPath = path.resolve(jobDir, 'audio.bin');
    const outPath = path.resolve(jobDir, 'out.mp4');

    try {
      if (!fs.existsSync(videoPath) || !fs.existsSync(audioPath)) {
        res.status(400).json({ error: 'Faltan pistas de video o audio para unir.' });
        return;
      }

      const ffmpegBin = await ensureFfmpeg();
      await execFileAsync(
        ffmpegBin,
        [
          '-y',
          '-i',
          videoPath,
          '-i',
          audioPath,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          '-movflags',
          '+faststart',
          outPath,
        ],
        { timeout: 120_000 }
      );

      const stat = await fs.promises.stat(outPath);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', String(stat.size));
      await pipeline(fs.createReadStream(outPath), res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error:
            err instanceof Error
              ? `Error uniendo audio y video MP4: ${err.message}`
              : 'No se pudo unir el audio y video MP4.',
        });
      }
    } finally {
      await cleanupJobDir(jobDir);
    }
  });

  app.post('/api/media-job/:jobId/transcode', async (req: Request, res: Response) => {
    const jobDir = resolveSafeJobDir(String(req.params.jobId || ''));
    if (!jobDir) {
      res.status(404).json({ error: 'Sesión de exportación inválida o expirada.' });
      return;
    }

    const inPath = path.resolve(jobDir, 'video.bin');
    const outPath = path.resolve(jobDir, 'out.mp4');

    try {
      if (!fs.existsSync(inPath)) {
        res.status(400).json({ error: 'No se recibió video para transcodificar.' });
        return;
      }

      const ffmpegBin = await ensureFfmpeg();
      await execFileAsync(
        ffmpegBin,
        [
          '-y',
          '-fflags',
          '+genpts',
          '-i',
          inPath,
          '-r',
          '30',
          '-vsync',
          'cfr',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          '-af',
          'aresample=async=1:first_pts=0',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          outPath,
        ],
        { timeout: 180_000 }
      );

      const stat = await fs.promises.stat(outPath);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', String(stat.size));
      await pipeline(fs.createReadStream(outPath), res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error:
            err instanceof Error
              ? `Error convirtiendo a MP4 universal: ${err.message}`
              : 'No se pudo convertir el video a MP4.',
        });
      }
    } finally {
      await cleanupJobDir(jobDir);
    }
  });

  app.post('/api/media-job/:jobId/extract-pcm', async (req: Request, res: Response) => {
    const jobDir = resolveSafeJobDir(String(req.params.jobId || ''));
    if (!jobDir) {
      res.status(404).json({ error: 'Sesión de audio inválida o expirada.' });
      return;
    }

    const inPath = path.resolve(jobDir, 'video.bin');
    const pcmPath = path.resolve(jobDir, 'audio16k.pcm');

    try {
      if (!fs.existsSync(inPath)) {
        res.status(400).json({ error: 'No se recibió archivo de video.' });
        return;
      }

      const body = (req.body || {}) as { start?: number; end?: number };
      const ffmpegBin = await ensureFfmpeg();
      const args: string[] = ['-y'];

      if (typeof body.start === 'number' && Number.isFinite(body.start) && body.start > 0) {
        args.push('-ss', String(body.start));
      }
      if (
        typeof body.end === 'number' &&
        Number.isFinite(body.end) &&
        body.end > (body.start || 0)
      ) {
        args.push('-t', String(body.end - (body.start || 0)));
      }

      args.push('-i', inPath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', pcmPath);
      await execFileAsync(ffmpegBin, args, { timeout: 120_000 });

      const stat = await fs.promises.stat(pcmPath);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(stat.size));
      await pipeline(fs.createReadStream(pcmPath), res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error:
            err instanceof Error
              ? `Error extrayendo audio PCM: ${err.message}`
              : 'No se pudo extraer la pista de audio.',
        });
      }
    } finally {
      await cleanupJobDir(jobDir);
    }
  });

  app.post('/api/media-job/:jobId/audio-peaks', async (req: Request, res: Response) => {
    const jobDir = resolveSafeJobDir(String(req.params.jobId || ''));
    if (!jobDir) {
      res.status(404).json({ error: 'Sesión de audio inválida o expirada.' });
      return;
    }

    const inPath = path.resolve(jobDir, 'video.bin');
    try {
      if (!fs.existsSync(inPath)) {
        res.status(400).json({ error: 'No se recibió archivo de video.' });
        return;
      }
      const body = (req.body || {}) as { numBins?: number };
      const ffmpegBin = await ensureFfmpeg();
      const result = await extractAudioPeaksFromFile(ffmpegBin, inPath, body.numBins);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? `Error extrayendo onda de audio: ${err.message}`
            : 'No se pudo analizar la onda de audio.',
      });
    } finally {
      await cleanupJobDir(jobDir);
    }
  });

  // N3 — Análisis de limpieza de audio: silencios (silencedetect) y medición
  // de volumen (loudnorm, primera pasada) sobre el medio subido al trabajo.
  // No modifica el medio: solo devuelve datos para que el editor proponga
  // cortes y ajustes reversibles.
  app.post('/api/media-job/:jobId/audio-cleanup-analyze', async (req: Request, res: Response) => {
    const jobDir = resolveSafeJobDir(String(req.params.jobId || ''));
    if (!jobDir) {
      res.status(404).json({ error: 'Sesión de audio inválida o expirada.' });
      return;
    }

    const inPath = path.resolve(jobDir, 'video.bin');
    try {
      if (!fs.existsSync(inPath)) {
        res.status(400).json({ error: 'No se recibió archivo de video.' });
        return;
      }
      const body = (req.body || {}) as { thresholdDb?: number; minSilenceSec?: number };
      const thresholdDb = Math.max(
        -45,
        Math.min(-22, Number.isFinite(Number(body.thresholdDb)) ? Number(body.thresholdDb) : -34)
      );
      const minSilenceSec = Math.max(
        0.25,
        Math.min(1.2, Number.isFinite(Number(body.minSilenceSec)) ? Number(body.minSilenceSec) : 0.45)
      );

      const ffmpegBin = await ensureFfmpeg();

      const silenceRun = await execFileAsync(
        ffmpegBin,
        [
          '-i',
          inPath,
          '-vn',
          '-af',
          `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec}`,
          '-f',
          'null',
          '-',
        ],
        { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }
      ).catch((err: { stderr?: string }) => ({ stderr: err?.stderr || '' }));
      const silenceStderr = String(silenceRun.stderr || '');
      const silences = parseSilenceDetectOutput(silenceStderr);
      const durationSec = parseFfmpegDuration(silenceStderr);

      const loudnormRun = await execFileAsync(
        ffmpegBin,
        [
          '-i',
          inPath,
          '-vn',
          '-af',
          'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
          '-f',
          'null',
          '-',
        ],
        { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }
      ).catch((err: { stderr?: string }) => ({ stderr: err?.stderr || '' }));
      const loudnorm = parseLoudnormMeasured(String(loudnormRun.stderr || ''));

      res.json({ durationSec, silences, loudnorm });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? `Error analizando el audio: ${err.message}`
            : 'No se pudo analizar el audio.',
      });
    } finally {
      await cleanupJobDir(jobDir);
    }
  });

  app.post('/api/media-job/:jobId/export-ffmpeg', async (req: Request, res: Response) => {
    const jobDir = resolveSafeJobDir(String(req.params.jobId || ''));
    if (!jobDir) {
      res.status(404).json({ error: 'Sesión de exportación inválida o expirada.' });
      return;
    }

    const uploadedVideoPath = path.resolve(jobDir, 'video.bin');
    const bgmPath = path.resolve(jobDir, 'audio.bin');
    const subsPath = path.resolve(jobDir, 'subs.ass');
    const outPath = path.resolve(jobDir, 'out.mp4');

    try {
      const body = (req.body || {}) as {
        mediaId?: string;
        saveToBatchFolder?: { projectTitle?: string; fileName?: string };
        settings?: Partial<AssBuilderSettings> & {
          ratio?: '9:16' | '1:1' | '16:9';
          fitMode?: 'cover' | 'blur' | 'fit';
          zoom?: number;
          bright?: number;
          contrast?: number;
          sat?: number;
          volVideo?: number;
          volBgm?: number;
          progressBar?: boolean;
          progressPos?: 'top' | 'bottom';
          progressColor?: string;
          silenceCutEnabled?: boolean;
          speechSegments?: Array<{ start: number; end: number }>;
          audioCleanupEnabled?: boolean;
          audioNormalizeEnabled?: boolean;
          audioDenoiseEnabled?: boolean;
          audioDenoiseStrength?: number;
          loudnormMeasured?: {
            inputI: number;
            inputTp: number;
            inputLra: number;
            inputThresh: number;
            targetOffset: number;
          } | null;
          // N4 — «Terminar mi clip» (acabado opcional al exportar)
          finishClipEnabled?: boolean;
          finishZoomEnabled?: boolean;
          finishZoomIntensity?: number;
          finishZoomMoments?: Array<{ start: number; end: number }>;
          finishKeywordsEnabled?: boolean;
          finishKeywords?: string;
          finishDuckingEnabled?: boolean;
          finishDuckingAmount?: number;
          finishSfxEnabled?: boolean;
          finishSfxVolume?: number;
          finishSfxTimes?: number[];
          transitionIn?: 'none' | 'fade' | 'zoom-punch' | 'slide-up';
          hookEnabled?: boolean;
          hookText?: string;
          hookStyle?: 'white-box' | 'dark-neon' | 'red-hook' | 'minimal-clean';
          hookBgColor?: string;
          hookTextColor?: string;
          hookY?: number;
          hookDurationSec?: number;
        };
        subtitles?: AssSubtitleCue[];
      };

      let sourceVideoPath = uploadedVideoPath;
      if (!fs.existsSync(sourceVideoPath) && body.mediaId) {
        const localPaths = resolveLocalMediaPaths(String(body.mediaId));
        if (localPaths && fs.existsSync(localPaths.binPath)) {
          sourceVideoPath = localPaths.binPath;
        }
      }

      if (!fs.existsSync(sourceVideoPath)) {
        res.status(400).json({ error: 'Falta el video fuente para exportar.' });
        return;
      }

      const s = body.settings || {};
      const ratio = s.ratio || '9:16';
      const W = ratio === '1:1' ? 1080 : ratio === '16:9' ? 1920 : 1080;
      const H = ratio === '9:16' ? 1920 : 1080;
      const trimStart = Math.max(0, Number(s.trimStart || 0));
      const trimEnd = Math.max(trimStart + 0.1, Number(s.trimEnd || trimStart + 10));
      const speed = Math.max(0.25, Math.min(4, Number(s.speed || 1)));
      const fitMode = s.fitMode || 'cover';
      const volVideo = Math.max(0, Math.min(200, Number(s.volVideo ?? 100)));
      const volBgm = Math.max(0, Math.min(200, Number(s.volBgm ?? 35)));
      const hasBgmFile = fs.existsSync(bgmPath) && fs.statSync(bgmPath).size > 0 && volBgm > 0;

      // N4 — «Terminar mi clip»: opciones normalizadas. Si la usuaria no lo
      // activó, enabled=false y no se aplica ningún efecto de acabado.
      const finishOpts = normalizeFinishClipOptions({
        enabled: Boolean(s.finishClipEnabled),
        zoomEnabled: s.finishZoomEnabled !== false,
        zoomIntensity: Number(s.finishZoomIntensity ?? 115),
        zoomMoments: Array.isArray(s.finishZoomMoments) ? s.finishZoomMoments : [],
        duckingEnabled: s.finishDuckingEnabled !== false,
        duckingAmount: Number(s.finishDuckingAmount ?? 60),
        sfxEnabled: Boolean(s.finishSfxEnabled),
        sfxVolume: Number(s.finishSfxVolume ?? 35),
        sfxTimes: Array.isArray(s.finishSfxTimes) ? s.finishSfxTimes : [],
        keywordHighlightEnabled: s.finishKeywordsEnabled !== false,
        keywords: typeof s.finishKeywords === 'string' ? [s.finishKeywords] : [],
      });

      // Resolve jump-cut speech segments safely
      let segments: Array<{ start: number; end: number }> = [{ start: trimStart, end: trimEnd }];
      if (s.silenceCutEnabled && Array.isArray(s.speechSegments) && s.speechSegments.length > 0) {
        const valid = s.speechSegments
          .map((seg) => ({
            start: Math.max(trimStart, Number(seg.start)),
            end: Math.min(trimEnd, Number(seg.end)),
          }))
          .filter((seg) => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end - seg.start >= 0.08)
          .sort((a, b) => a.start - b.start);
        if (valid.length > 0) {
          while (valid.length > 42) {
            let minGapIdx = 0;
            let minGap = Infinity;
            for (let i = 0; i < valid.length - 1; i++) {
              const gap = valid[i + 1].start - valid[i].end;
              if (gap < minGap) {
                minGap = gap;
                minGapIdx = i;
              }
            }
            valid[minGapIdx].end = valid[minGapIdx + 1].end;
            valid.splice(minGapIdx + 1, 1);
          }
          segments = valid;
        }
      }

      const srcDur = Math.max(
        0.1,
        segments.reduce((acc, seg) => acc + Math.max(0, seg.end - seg.start), 0)
      );
      const outDur = srcDur / speed;

      const ffmpegBin = await ensureFfmpeg();

      // Quick probe to see if source video contains an audio stream
      const hasVideoAudio = await new Promise<boolean>((resolve) => {
        execFile(ffmpegBin, ['-i', sourceVideoPath], { timeout: 10_000 }, (_err, _so, se) => {
          resolve(/Stream\s+#0:\d+.*Audio:/i.test(se || ''));
        });
      });

      const rawCues = Array.isArray(body.subtitles) ? body.subtitles : [];
      // N4 — Resaltado de palabras clave en los subtítulos (sintaxis *...*
      // que ya entiende el constructor ASS), solo si la usuaria lo activó.
      const cues =
        finishOpts.enabled &&
        finishOpts.keywordHighlightEnabled &&
        finishOpts.keywords.length > 0
          ? highlightKeywordsInCues(rawCues, finishOpts.keywords)
          : rawCues;
      const hasHook = Boolean(s.hookEnabled && s.hookText?.trim());
      const hasAssOverlay = cues.length > 0 || hasHook;

      if (hasAssOverlay) {
        const assContent = buildAssSubtitles(cues, {
          width: W,
          height: H,
          trimStart,
          trimEnd,
          speed,
          speechSegments: segments,
          subUpper: Boolean(s.subUpper ?? true),
          subSize: Number(s.subSize ?? 68),
          subY: Number(s.subY ?? 68),
          subStroke: Number(s.subStroke ?? 13),
          subShadow: Number(s.subShadow ?? 18),
          subColor: String(s.subColor || '#ffffff'),
          subHighlight: String(s.subHighlight || '#facc15'),
          subStrokeColor: String(s.subStrokeColor || '#000000'),
          subBgColor: String(s.subBgColor || '#0f172a'),
          subBgMode: s.subBgMode || 'none',
          hook: hasHook
            ? {
                enabled: true,
                text: String(s.hookText || ''),
                style: s.hookStyle || 'white-box',
                bgColor: String(s.hookBgColor || '#ffffff'),
                textColor: String(s.hookTextColor || '#0f172a'),
                yPct: Number(s.hookY ?? 14),
                durationSec: Number(s.hookDurationSec ?? 3.5),
              }
            : undefined,
        });
        await fs.promises.writeFile(subsPath, assContent, 'utf8');
      }

      // Fast keyframe pre-seek when cutting from deep inside long Desktop videos
      const firstStart = segments[0].start;
      const lastEnd = segments[segments.length - 1].end;
      const preSeek = firstStart > 3 ? Math.max(0, Number((firstStart - 0.5).toFixed(3))) : 0;
      const relSegments = segments.map((seg) => ({
        start: Math.max(0, seg.start - preSeek),
        end: Math.max(0.05, seg.end - preSeek),
      }));

      const filters: string[] = [];

      if (relSegments.length === 1) {
        let vChain = `[0:v]trim=start=${relSegments[0].start.toFixed(3)}:end=${relSegments[0].end.toFixed(3)},setpts=PTS-STARTPTS`;
        if (Math.abs(speed - 1) > 0.005) {
          vChain += `,setpts=PTS/${speed.toFixed(4)}`;
        }
        filters.push(`${vChain}[vtrim]`);
      } else {
        const k = relSegments.length;
        const splitLabels = relSegments.map((_, idx) => `[vs${idx}]`);
        filters.push(`[0:v]split=${k}${splitLabels.join('')}`);
        const sliceLabels: string[] = [];
        for (let idx = 0; idx < k; idx++) {
          const seg = relSegments[idx];
          filters.push(
            `[vs${idx}]trim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},setpts=PTS-STARTPTS[vc${idx}]`
          );
          sliceLabels.push(`[vc${idx}]`);
        }
        const speedSuffix =
          Math.abs(speed - 1) > 0.005 ? `,setpts=PTS/${speed.toFixed(4)}` : '';
        filters.push(`${sliceLabels.join('')}concat=n=${k}:v=1:a=0${speedSuffix}[vtrim]`);
      }

      if (fitMode === 'fit') {
        filters.push(
          `[vtrim]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black[vframe]`
        );
      } else if (fitMode === 'blur') {
        filters.push('[vtrim]split=2[vbg][vfg]');
        filters.push(
          `[vbg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:5[vbgb]`
        );
        filters.push(`[vfg]scale=${W}:${H}:force_original_aspect_ratio=decrease[vfgs]`);
        filters.push('[vbgb][vfgs]overlay=(W-w)/2:(H-h)/2[vframe]');
      } else {
        const zoomFactor = Math.max(1, Math.min(2.5, Number(s.zoom || 100) / 100));
        if (zoomFactor > 1.02) {
          const zW = Math.round(W * zoomFactor);
          const zH = Math.round(H * zoomFactor);
          filters.push(
            `[vtrim]scale=${zW}:${zH}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})/2:(ih-${H})/2[vframe]`
          );
        } else {
          filters.push(
            `[vtrim]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[vframe]`
          );
        }
      }

      let curVLabel = 'vframe';
      const bright = Number(s.bright ?? 100);
      const contrast = Number(s.contrast ?? 100);
      const sat = Number(s.sat ?? 100);
      if (bright !== 100 || contrast !== 100 || sat !== 100) {
        const eqB = ((bright - 100) / 200).toFixed(3);
        const eqC = Math.max(0.2, contrast / 100).toFixed(3);
        const eqS = Math.max(0, sat / 100).toFixed(3);
        filters.push(`[${curVLabel}]eq=brightness=${eqB}:contrast=${eqC}:saturation=${eqS}[veq]`);
        curVLabel = 'veq';
      }

      // Entry transition (TikTok / Reels style)
      const transitionIn = s.transitionIn || 'none';
      if (transitionIn === 'fade') {
        filters.push(`[${curVLabel}]fade=t=in:st=0:d=0.45[vtrans]`);
        curVLabel = 'vtrans';
      } else if (transitionIn === 'zoom-punch') {
        filters.push(
          `[${curVLabel}]crop=w='iw/(1+0.15*(1-min(1,t/0.42)))':h='ih/(1+0.15*(1-min(1,t/0.42)))':x='(iw-out_w)/2':y='(ih-out_h)/2',scale=${W}:${H}[vtrans]`
        );
        curVLabel = 'vtrans';
      } else if (transitionIn === 'slide-up') {
        filters.push(`color=c=black:s=${W}x${H}:r=30:d=${outDur.toFixed(3)}[bgslide]`);
        filters.push(
          `[bgslide][${curVLabel}]overlay=y='if(lt(t,0.40),pow(1-t/0.40,2)*(H*0.20),0)':eof_action=pass[vtrans]`
        );
        curVLabel = 'vtrans';
      }

      // N4 — Zoom suave de énfasis en los momentos calculados por el
      // editor. Va antes de los subtítulos para que el texto no se mueva.
      if (finishZoomActive(finishOpts)) {
        filters.push(
          buildEmphasisZoomFilter(finishOpts, W, H, curVLabel, 'vzoom')
        );
        curVLabel = 'vzoom';
      }

      if (hasAssOverlay) {
        filters.push(`[${curVLabel}]ass=subs.ass[vsub]`);
        curVLabel = 'vsub';
      }

      if (s.progressBar) {
        const cleanHex = String(s.progressColor || '#f43f5e')
          .replace('#', '')
          .replace(/[^a-fA-F0-9]/g, '')
          .padEnd(6, '0')
          .slice(0, 6);
        const barY = s.progressPos === 'bottom' ? H - 8 : 0;
        filters.push(`[${curVLabel}]setsar=1[vmain]`);
        filters.push(`color=c=0x${cleanHex}:s=${W}x8:r=30:d=${outDur.toFixed(3)}[pbar]`);
        filters.push(
          `[vmain][pbar]overlay=x='-W+(t/${outDur.toFixed(3)})*W':y=${barY}:shortest=1,format=yuv420p[vout]`
        );
      } else {
        filters.push(`[${curVLabel}]setsar=1,format=yuv420p[vout]`);
      }

      const buildAtempoFilters = (spd: number): string[] => {
        const parts: string[] = [];
        let rem = spd;
        while (rem > 2.0) {
          parts.push('atempo=2.0');
          rem /= 2.0;
        }
        while (rem < 0.5) {
          parts.push('atempo=0.5');
          rem /= 0.5;
        }
        if (Math.abs(rem - 1) > 0.005) {
          parts.push(`atempo=${rem.toFixed(4)}`);
        }
        return parts;
      };

      const useVideoAudio = hasVideoAudio && volVideo > 0;
      if (useVideoAudio) {
        const tempoChain = buildAtempoFilters(speed);
        const volStr = `volume=${(volVideo / 100).toFixed(2)}`;
        // N3 — Limpieza de audio: afftdn + loudnorm solo si la usuaria lo
        // activó en el editor; se aplica sobre la voz ya recortada y no
        // toca la música de fondo.
        const cleanupFilters = buildAudioCleanupFilters(
          normalizeAudioCleanupOptions({
            enabled: Boolean(s.audioCleanupEnabled),
            normalize: s.audioNormalizeEnabled !== false,
            denoise: Boolean(s.audioDenoiseEnabled),
            denoiseStrength: Number(s.audioDenoiseStrength ?? 40),
            measured: s.loudnormMeasured ?? null,
          })
        );
        if (relSegments.length === 1) {
          const aOps = [
            `atrim=start=${relSegments[0].start.toFixed(3)}:end=${relSegments[0].end.toFixed(3)}`,
            'asetpts=PTS-STARTPTS',
            ...tempoChain,
            volStr,
            ...cleanupFilters,
          ];
          filters.push(`[0:a]${aOps.join(',')}[va]`);
        } else {
          const k = relSegments.length;
          const splitLabels = relSegments.map((_, idx) => `[as${idx}]`);
          filters.push(`[0:a]asplit=${k}${splitLabels.join('')}`);
          const sliceLabels: string[] = [];
          for (let idx = 0; idx < k; idx++) {
            const seg = relSegments[idx];
            filters.push(
              `[as${idx}]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[ac${idx}]`
            );
            sliceLabels.push(`[ac${idx}]`);
          }
          const postOps = [...tempoChain, volStr, ...cleanupFilters].join(',');
          filters.push(`${sliceLabels.join('')}concat=n=${k}:v=0:a=1,${postOps}[va]`);
        }
      }

      if (hasBgmFile) {
        filters.push(
          `[1:a]aloop=loop=-1:size=2000000000,atrim=0:${outDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${(volBgm / 100).toFixed(2)}[ba]`
        );
      }

      // Mezcla principal hacia [amain]; la salida final [aout] se cierra
      // más abajo (efecto de sonido N4 y re-muestreo común).
      // N4 — Ducking: la música cargada por la usuaria baja sola cuando
      // hay voz, usando la voz como señal de control (sidechaincompress).
      const duckingOn =
        finishDuckingActive(finishOpts) && useVideoAudio && hasBgmFile;
      if (useVideoAudio && hasBgmFile && duckingOn) {
        filters.push('[va]asplit=2[vaMix][vaKey]');
        filters.push(buildDuckingFilter(finishOpts, 'ba', 'vaKey', 'baDuck'));
        filters.push('[vaMix][baDuck]amix=inputs=2:duration=shortest:normalize=0[amain]');
      } else if (useVideoAudio && hasBgmFile) {
        filters.push('[va][ba]amix=inputs=2:duration=shortest:normalize=0[amain]');
      } else if (useVideoAudio) {
        filters.push('[va]anull[amain]');
      } else if (hasBgmFile) {
        filters.push('[ba]anull[amain]');
      } else {
        filters.push(`anullsrc=r=48000:cl=stereo:d=${outDur.toFixed(3)}[amain]`);
      }

      // N4 — Efecto de sonido sutil en los cambios de escena (cortes entre
      // bloques de voz), sintetizado por FFmpeg y solo si se activó.
      if (finishSfxActive(finishOpts)) {
        const sfx = buildSfxSourceFilters(finishOpts);
        filters.push(...sfx.filters);
        filters.push(
          `[amain]${sfx.labels.join('')}amix=inputs=${sfx.labels.length + 1}:duration=first:normalize=0[amixout]`
        );
        filters.push('[amixout]aresample=async=1:first_pts=0[aout]');
      } else {
        filters.push('[amain]aresample=async=1:first_pts=0[aout]');
      }

      const ffmpegArgs: string[] = ['-y'];
      if (preSeek > 0) {
        ffmpegArgs.push('-ss', preSeek.toFixed(3), '-to', (lastEnd + 0.5).toFixed(3));
      }
      ffmpegArgs.push('-i', sourceVideoPath);
      if (hasBgmFile) {
        ffmpegArgs.push('-i', 'audio.bin');
      }
      ffmpegArgs.push(
        '-filter_complex',
        filters.join(';'),
        '-map',
        '[vout]',
        '-map',
        '[aout]',
        '-r',
        '30',
        '-vsync',
        'cfr',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        '-movflags',
        '+faststart',
        'out.mp4'
      );

      await execFileAsync(ffmpegBin, ffmpegArgs, { cwd: jobDir, timeout: 300_000 });

      const stat = await fs.promises.stat(outPath);

      if (body.saveToBatchFolder?.fileName) {
        const projFolder = sanitizeDownloadFilename(
          body.saveToBatchFolder.projectTitle || 'ShortStudio_Lote'
        ).replace(/\.[^/.]+$/, '');
        const baseFile = sanitizeDownloadFilename(
          body.saveToBatchFolder.fileName.replace(/\.mp4$/i, '')
        );
        const batchDir = path.join(os.homedir(), 'Downloads', 'ShortStudio', 'Lotes', projFolder);
        await fs.promises.mkdir(batchDir, { recursive: true });
        let destPath = path.join(batchDir, `${baseFile}.mp4`);
        if (fs.existsSync(destPath)) {
          destPath = path.join(batchDir, `${baseFile}_${Date.now().toString().slice(-4)}.mp4`);
        }
        await fs.promises.copyFile(outPath, destPath);
        res.json({ ok: true, savedPath: destPath, size: stat.size });
        return;
      }

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', String(stat.size));
      await pipeline(fs.createReadStream(outPath), res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error:
            err instanceof Error
              ? `Error en renderizado FFmpeg rápido: ${err.message}`
              : 'No se pudo completar el renderizado FFmpeg.',
        });
      }
    } finally {
      await cleanupJobDir(jobDir);
    }
  });

  app.post(
    '/api/transcode-mp4',
    express.raw({ type: '*/*', limit: '500mb' }),
    async (req: Request, res: Response) => {
      const buf = req.body as Buffer | undefined;
      if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ error: 'No se recibió contenido de video para transcodificar.' });
        return;
      }

      const stamp = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const inPath = path.join(os.tmpdir(), `ss_in_${stamp}.bin`);
      const outPath = path.join(os.tmpdir(), `ss_out_${stamp}.mp4`);

      try {
        await fs.promises.writeFile(inPath, buf);
        const ffmpegBin = await ensureFfmpeg();
        await execFileAsync(
          ffmpegBin,
          [
            '-y',
            '-fflags',
            '+genpts',
            '-i',
            inPath,
            '-r',
            '30',
            '-vsync',
            'cfr',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-af',
            'aresample=async=1:first_pts=0',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-movflags',
            '+faststart',
            outPath,
          ],
          { timeout: 180_000 }
        );

        const stat = await fs.promises.stat(outPath);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', String(stat.size));
        await pipeline(fs.createReadStream(outPath), res);
      } catch (err) {
        if (!res.headersSent) {
          res.status(500).json({
            error:
              err instanceof Error
                ? `Error convirtiendo a MP4 universal: ${err.message}`
                : 'No se pudo convertir el video a MP4.',
          });
        }
      } finally {
        [inPath, outPath].forEach((p) => {
          try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch {
            // ignore cleanup errors
          }
        });
      }
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir =
      options.distDir ||
      process.env.SHORTSTUDIO_DIST_DIR ||
      path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // C1: por defecto el servidor solo escucha en el propio equipo. Para
  // exponerlo en la red local hay que pedirlo de forma explícita con
  // options.host o con la variable de entorno SHORTSTUDIO_HOST=0.0.0.0
  // (e incluso entonces la API seguirá exigiendo el token).
  const targetHost = options.host || process.env.SHORTSTUDIO_HOST || '127.0.0.1';
  const targetPort = options.port !== undefined ? options.port : PORT;

  return await new Promise<{
    app: ReturnType<typeof express>;
    server: import('node:http').Server;
    port: number;
    apiToken: string;
  }>((resolve, reject) => {
    const server = app.listen(targetPort, targetHost, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : targetPort;
      console.log(`ShortStudio server listening on http://${targetHost}:${actualPort}`);
      resolve({ app, server, port: actualPort, apiToken });
    });
    server.once('error', (err) => {
      reject(err);
    });
  });
}

const entryArg = process.argv[1] ? path.resolve(process.argv[1]) : '';
const currentFile = fileURLToPath(import.meta.url);
if (entryArg && entryArg === currentFile) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
