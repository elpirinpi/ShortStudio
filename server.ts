import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Innertube } from 'youtubei.js';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 3000);
const MAX_VIDEO_BYTES = 450 * 1024 * 1024; // 450 MB safety cap
const IS_WINDOWS = process.platform === 'win32';
const YTDLP_RELEASE_URL = IS_WINDOWS
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
const FFMPEG_WIN_ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
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
let cachedYtDlpPath: string | null = null;
let cachedFfmpegPath: string | null = null;
let cachedDenoPath: string | null = null;

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
    signal: AbortSignal.timeout(60000),
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

async function ensureFfmpeg(): Promise<string> {
  const existing = resolveFfmpegPathSync();
  if (existing) return existing;

  if (!IS_WINDOWS) {
    return 'ffmpeg';
  }

  try {
    const { stdout } = await execFileAsync('where.exe', ['ffmpeg'], { timeout: 4000 });
    const first = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first && fs.existsSync(first)) {
      cachedFfmpegPath = first;
      return first;
    }
  } catch {
    // fallback to downloading portable ffmpeg.exe
  }

  const binDir = getRuntimeBinDir();
  fs.mkdirSync(binDir, { recursive: true });
  const targetExe = path.join(binDir, 'ffmpeg.exe');
  const tmpZip = path.join(os.tmpdir(), `ss_ffmpeg_${Date.now()}.zip`);
  const tmpExtract = path.join(os.tmpdir(), `ss_ffmpeg_ex_${Date.now()}`);

  try {
    const resp = await fetch(FFMPEG_WIN_ZIP_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok || !resp.body) return 'ffmpeg';
    await fs.promises.writeFile(tmpZip, Buffer.from(await resp.arrayBuffer()));
    await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${tmpExtract.replace(/'/g, "''")}' -Force`,
      ],
      { timeout: 120000 }
    );

    const findFfmpegExe = (dir: string): string | null => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = findFfmpegExe(full);
          if (found) return found;
        } else if (entry.name.toLowerCase() === 'ffmpeg.exe') {
          return full;
        }
      }
      return null;
    };

    const found = findFfmpegExe(tmpExtract);
    if (found) {
      await fs.promises.copyFile(found, targetExe);
      cachedFfmpegPath = targetExe;
      return targetExe;
    }
  } catch {
    // ignore and fallback
  } finally {
    fs.promises.rm(tmpZip, { force: true }).catch(() => {});
    fs.promises.rm(tmpExtract, { recursive: true, force: true }).catch(() => {});
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

  fs.mkdirSync(binDir, { recursive: true });
  const targetDeno = path.join(binDir, 'deno.exe');
  const tmpZip = path.join(os.tmpdir(), `ss_deno_${Date.now()}.zip`);
  try {
    const resp = await fetch(DENO_WIN_ZIP_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok || !resp.body) return null;
    await fs.promises.writeFile(tmpZip, Buffer.from(await resp.arrayBuffer()));
    await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${binDir.replace(/'/g, "''")}' -Force`,
      ],
      { timeout: 60000 }
    );
    if (fs.existsSync(targetDeno)) {
      cachedDenoPath = targetDeno;
      return targetDeno;
    }
  } catch {
    // optional
  } finally {
    fs.promises.rm(tmpZip, { force: true }).catch(() => {});
  }
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

async function runYtDlpDownload(
  targetUrl: string,
  extraArgs: string[] = []
): Promise<YtDlpResult | YtDlpError> {
  const ytDlpBin = await ensureYtDlp();
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
      const denoExe = await ensureDenoOnWindows();
      if (denoExe) {
        args.push('--js-runtimes', `deno:${denoExe}`, '--remote-components', 'ejs:github');
      }
    } else if (!('electron' in process.versions)) {
      args.push('--js-runtimes', `node:${process.execPath}`);
    }

    const ffmpegPath = await ensureFfmpeg();
    if (ffmpegPath && ffmpegPath !== 'ffmpeg') {
      args.push('--ffmpeg-location', ffmpegPath);
    }

    args.push('--', targetUrl);

    const { stdout } = await execFileAsync(ytDlpBin, args, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const lastLine = lines[lines.length - 1] || '';
    const [printedTitle, printedExtractor, printedPath] = lastLine.split('\t');

    let downloadedPath = printedPath ? path.resolve(printedPath) : '';
    if (
      !downloadedPath ||
      !downloadedPath.startsWith(workDir + path.sep) ||
      !fs.existsSync(downloadedPath)
    ) {
      const entries = await fs.promises.readdir(workDir);
      const mediaFile = entries.find((name) => /\.(mp4|webm|mkv|mov|m4v)$/i.test(name));
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

    const ext = path.extname(downloadedPath).toLowerCase();
    const mimeType =
      ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';

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
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr?: unknown }).stderr || '')
        : '';
    const rawMsg =
      stderr.trim() || (err instanceof Error ? err.message : 'Error ejecutando yt-dlp.');
    const cleanReason =
      rawMsg
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('ERROR:'))
        .join(' ')
        .replace(/See\s+https?:\/\/\S+.*$/i, '')
        .trim() || rawMsg;

    return {
      ok: false,
      reason: cleanReason,
    };
  }
}

async function streamYtDlpResult(res: Response, result: YtDlpResult, sourceLabel?: string) {
  try {
    const stat = await fs.promises.stat(result.filePath);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('X-Video-Title', encodeURIComponent(result.title));
    res.setHeader('X-Video-Source', sourceLabel || `ytdlp-${result.extractor}`);
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

async function downloadToFile(url: string, destPath: string, userAgent: string): Promise<void> {
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
                downloadToFile(videoUrl, tmpVideo, ua),
                downloadToFile(audioUrl, tmpAudio, ua),
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
}

export async function startServer(options: StartServerOptions = {}) {
  if (options.binDir) {
    activeBinDir = options.binDir;
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      platform: process.platform,
      developer: 'Kelly Benjamin De La Cruz',
    });
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

  const targetHost = options.host || '0.0.0.0';
  const targetPort = options.port !== undefined ? options.port : PORT;

  return await new Promise<{
    app: ReturnType<typeof express>;
    server: import('node:http').Server;
    port: number;
  }>((resolve, reject) => {
    const server = app.listen(targetPort, targetHost, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : targetPort;
      console.log(`ShortStudio server listening on http://${targetHost}:${actualPort}`);
      resolve({ app, server, port: actualPort });
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
