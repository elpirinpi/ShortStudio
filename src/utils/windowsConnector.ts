import { AppSettings } from '../types/editor';

export const WINDOWS_CONNECTOR_PORT = 47123;
export const WINDOWS_CONNECTOR_BASE_URL = `http://127.0.0.1:${WINDOWS_CONNECTOR_PORT}`;

export interface ConnectorStatus {
  connected: boolean;
  authMismatch?: boolean;
  blockedInIframe?: boolean;
  saveDir?: string;
  ytdlpReady?: boolean;
  ffmpegReady?: boolean;
}

export function isRunningInIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export interface ConnectorDownloadProgress {
  percent: number;
  label: string;
}

export interface ConnectorDownloadSuccess {
  ok: true;
  blob: Blob;
  fileName: string;
  title: string;
  savedPath: string;
}

export interface ConnectorDownloadFailure {
  ok: false;
  error: string;
  unreachable?: boolean;
}

export function generateConnectorToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function ensureConnectorToken(settings: AppSettings): {
  token: string;
  updatedSettings: AppSettings | null;
} {
  const existing = (settings.localConnectorToken || '').trim();
  if (/^[a-f0-9]{16,64}$/i.test(existing)) {
    return { token: existing, updatedSettings: null };
  }
  const token = generateConnectorToken();
  return {
    token,
    updatedSettings: { ...settings, localConnectorToken: token },
  };
}

export async function probeWindowsConnector(token: string): Promise<ConnectorStatus> {
  if (!token) return { connected: false, blockedInIframe: isRunningInIframe() };
  try {
    const res = await fetch(`${WINDOWS_CONNECTOR_BASE_URL}/health`, {
      method: 'GET',
      headers: {
        'X-ShortStudio-Token': token,
      },
      signal: AbortSignal.timeout(1800),
    });

    if (res.status === 401 || res.status === 403) {
      return { connected: false, authMismatch: true };
    }
    if (!res.ok) {
      return { connected: false };
    }

    const data = (await res.json()) as {
      ok?: boolean;
      saveDir?: string;
      ytdlpReady?: boolean;
      ffmpegReady?: boolean;
    };

    return {
      connected: Boolean(data.ok),
      saveDir: data.saveDir,
      ytdlpReady: data.ytdlpReady,
      ffmpegReady: data.ffmpegReady,
    };
  } catch {
    return { connected: false, blockedInIframe: isRunningInIframe() };
  }
}

async function readResponseBlobWithProgress(
  res: Response,
  basePercent: number,
  onProgress?: (p: ConnectorDownloadProgress) => void
): Promise<Blob> {
  const totalBytes = Number(res.headers.get('content-length') || 0);
  if (!res.body || typeof res.body.getReader !== 'function') {
    return await res.blob();
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      if (onProgress && totalBytes > 0) {
        const ratio = Math.min(1, loaded / totalBytes);
        const pct = Math.min(100, Math.round(basePercent + ratio * (100 - basePercent)));
        const mbLoaded = (loaded / (1024 * 1024)).toFixed(1);
        const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);
        onProgress({
          percent: pct,
          label: `Cargando MP4 al editor... ${pct}% (${mbLoaded} / ${mbTotal} MB)`,
        });
      }
    }
  }

  return new Blob(chunks as BlobPart[], {
    type: res.headers.get('content-type') || 'video/mp4',
  });
}

function buildConnectorSuccessFromResponse(
  res: Response,
  blob: Blob
): ConnectorDownloadSuccess | ConnectorDownloadFailure {
  if (!blob || blob.size === 0) {
    return { ok: false, error: 'El archivo MP4 devuelto por el conector está vacío.' };
  }
  const rawTitle = res.headers.get('x-video-title');
  const rawFile = res.headers.get('x-file-name');
  const rawSavedPath = res.headers.get('x-saved-path');

  const title = rawTitle ? decodeURIComponent(rawTitle) : `Video_${Date.now()}`;
  const fileName = rawFile
    ? decodeURIComponent(rawFile)
    : `${title.replace(/[^\p{L}\p{N}\s_-]/gu, '').trim() || 'video'}.mp4`;
  const savedPath = rawSavedPath
    ? decodeURIComponent(rawSavedPath)
    : `Descargas\\ShortStudio\\${fileName}`;

  return {
    ok: true,
    blob,
    fileName,
    title,
    savedPath,
  };
}

export async function downloadViaWindowsConnector(
  url: string,
  token: string,
  onProgress?: (p: ConnectorDownloadProgress) => void
): Promise<ConnectorDownloadSuccess | ConnectorDownloadFailure> {
  try {
    onProgress?.({ percent: 2, label: 'Iniciando descarga en tu PC...' });

    // Prefer async /start + /status/:id + /file/:id for real-time percentage
    const startRes = await fetch(`${WINDOWS_CONNECTOR_BASE_URL}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ShortStudio-Token': token,
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(15_000),
    });

    if (startRes.status === 401 || startRes.status === 403) {
      return {
        ok: false,
        error:
          'El conector abierto en tu PC tiene otro token. Cierra la ventana negra anterior y abre el lanzador .bat recién descargado.',
      };
    }

    if (startRes.ok) {
      const startData = (await startRes.json()) as { jobId?: string; error?: string };
      const jobId = startData.jobId;
      if (!jobId) {
        return {
          ok: false,
          error: startData.error || 'El conector no devolvió un ID de descarga.',
        };
      }

      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 350));
        const stRes = await fetch(`${WINDOWS_CONNECTOR_BASE_URL}/status/${jobId}`, {
          method: 'GET',
          headers: { 'X-ShortStudio-Token': token },
          signal: AbortSignal.timeout(5000),
        });
        if (!stRes.ok) {
          const errPayload = (await stRes.json().catch(() => ({}))) as { error?: string };
          return {
            ok: false,
            error: errPayload.error || `Error consultando progreso (HTTP ${stRes.status}).`,
          };
        }

        const st = (await stRes.json()) as {
          status?: string;
          percent?: number;
          detail?: string;
          error?: string;
        };

        if (typeof st.percent === 'number' || st.detail) {
          onProgress?.({
            percent: Math.min(96, Math.max(2, Math.round(st.percent ?? 2))),
            label: st.detail || 'Descargando MP4 en tu PC...',
          });
        }

        if (st.status === 'error') {
          return {
            ok: false,
            error: st.error || 'yt-dlp falló al descargar este video.',
          };
        }

        if (st.status === 'ready') {
          onProgress?.({ percent: 96, label: 'Cargando MP4 al editor... 96%' });
          const fileRes = await fetch(`${WINDOWS_CONNECTOR_BASE_URL}/file/${jobId}`, {
            method: 'GET',
            headers: { 'X-ShortStudio-Token': token },
            signal: AbortSignal.timeout(120_000),
          });
          if (!fileRes.ok) {
            const errPayload = (await fileRes.json().catch(() => ({}))) as { error?: string };
            return {
              ok: false,
              error: errPayload.error || `Error transfiriendo MP4 (HTTP ${fileRes.status}).`,
            };
          }
          const blob = await readResponseBlobWithProgress(fileRes, 96, onProgress);
          onProgress?.({ percent: 100, label: 'MP4 listo en el editor (100%)' });
          return buildConnectorSuccessFromResponse(fileRes, blob);
        }
      }

      return { ok: false, error: 'La descarga tardó demasiado y superó el tiempo límite.' };
    }

    // Legacy fallback if an older .bat (without /start) is running
    if (startRes.status !== 404) {
      const payload = (await startRes.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        error:
          payload.error ||
          `El conector local respondió con estado ${startRes.status} al iniciar la descarga.`,
      };
    }

    onProgress?.({ percent: 15, label: 'Descargando MP4 en tu PC...' });
    const res = await fetch(`${WINDOWS_CONNECTOR_BASE_URL}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ShortStudio-Token': token,
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(180_000),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error:
          'El conector abierto en tu PC tiene otro token. Cierra la ventana negra anterior y abre el lanzador .bat recién descargado.',
      };
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || contentType.includes('application/json')) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        error:
          payload.error ||
          `El conector local respondió con estado ${res.status} al descargar el video.`,
      };
    }

    const blob = await readResponseBlobWithProgress(res, 75, onProgress);
    onProgress?.({ percent: 100, label: 'MP4 listo en el editor (100%)' });
    return buildConnectorSuccessFromResponse(res, blob);
  } catch (err) {
    return {
      ok: false,
      unreachable: true,
      error:
        err instanceof Error
          ? `No se pudo conectar con ShortStudio Conector en tu PC (${err.message}).`
          : 'No se pudo conectar con el Conector Local en tu PC.',
    };
  }
}

export function saveBlobToPcDownloads(blob: Blob, fileName: string): void {
  const cleanName = /\.(mp4|webm|mov|m4v)$/i.test(fileName) ? fileName : `${fileName}.mp4`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = cleanName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function sanitizePowershellSingleQuoted(val: string): string {
  return val.replace(/'/g, "''");
}

export function buildWindowsConnectorScript(token: string, origin: string): string {
  const safeToken = sanitizePowershellSingleQuoted(token);
  const safeOrigin = sanitizePowershellSingleQuoted(origin);

  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'title ShortStudio Conector Local PC (Windows)',
    'set "SELF_BAT=%~f0"',
    'set "BRIDGE_DIR=%LOCALAPPDATA%\\ShortStudioConnector"',
    'if not exist "%BRIDGE_DIR%" mkdir "%BRIDGE_DIR%"',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=[IO.File]::ReadAllText($env:SELF_BAT,[Text.Encoding]::UTF8);$m=\'#___PS_\'+\'START___\';$i=$c.IndexOf($m);if($i -lt 0){throw \'Bloque PowerShell no encontrado\'};[IO.File]::WriteAllText((Join-Path $env:BRIDGE_DIR \'bridge.ps1\'),$c.Substring($i),[Text.Encoding]::UTF8)"',
    'if errorlevel 1 (',
    '  echo.',
    '  echo [ERROR] No se pudo preparar el conector local.',
    '  pause',
    '  exit /b 1',
    ')',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%BRIDGE_DIR%\\bridge.ps1"',
    'if errorlevel 1 pause',
    'exit /b',
    '#___PS_START___',
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    '$env:PYTHONUTF8 = "1"',
    '$env:PYTHONIOENCODING = "utf-8"',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '',
    `$ExpectedToken = '${safeToken}'`,
    `$AllowedOrigins = @('${safeOrigin}', 'http://localhost:3000', 'http://127.0.0.1:3000')`,
    `$Port = ${WINDOWS_CONNECTOR_PORT}`,
    '$script:LoggedBrowserLink = $false',
    '',
    '$BaseDir = Join-Path $env:LOCALAPPDATA "ShortStudioConnector"',
    '$BinDir = Join-Path $BaseDir "bin"',
    'New-Item -ItemType Directory -Force -Path $BinDir | Out-Null',
    '',
    'try {',
    '  $shellApp = New-Object -ComObject Shell.Application',
    '  $downloadsRoot = $shellApp.NameSpace("shell:Downloads").Self.Path',
    '} catch {',
    '  $downloadsRoot = ""',
    '}',
    'if (-not $downloadsRoot) { $downloadsRoot = Join-Path $env:USERPROFILE "Downloads" }',
    '$SaveDir = Join-Path $downloadsRoot "ShortStudio"',
    'New-Item -ItemType Directory -Force -Path $SaveDir | Out-Null',
    '$CanonicalSaveDir = [System.IO.Path]::GetFullPath($SaveDir).TrimEnd("\\", "/")',
    '',
    '$YtDlpExe = Join-Path $BinDir "yt-dlp.exe"',
    '$FfmpegExe = Join-Path $BinDir "ffmpeg.exe"',
    '$DenoExe = Join-Path $BinDir "deno.exe"',
    '',
    'function Download-FileFast([string]$Url, [string]$Dest) {',
    '  $prev = $ErrorActionPreference',
    '  $ErrorActionPreference = "Continue"',
    '  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {',
    '    & curl.exe -fsSL -L -o $Dest $Url',
    '  }',
    '  $ErrorActionPreference = $prev',
    '  if (-not (Test-Path $Dest)) {',
    '    Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing',
    '  }',
    '}',
    '',
    'function Ensure-Tools {',
    '  if (-not (Test-Path $script:YtDlpExe)) {',
    '    Write-Host "[1/3] Descargando yt-dlp.exe oficial para Windows..." -ForegroundColor Cyan',
    '    Download-FileFast "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" $script:YtDlpExe',
    '    if (-not (Test-Path $script:YtDlpExe)) { throw "No se pudo descargar yt-dlp.exe" }',
    '    Write-Host "      yt-dlp.exe listo." -ForegroundColor Green',
    '  }',
    '  $sysFfmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue',
    '  if (-not (Test-Path $script:FfmpegExe) -and -not $sysFfmpeg) {',
    '    Write-Host "[2/3] Descargando FFmpeg portable (solo esta primera vez)..." -ForegroundColor Cyan',
    '    $zipPath = Join-Path $env:TEMP ("ss_ffmpeg_" + [Guid]::NewGuid().ToString("N") + ".zip")',
    '    try {',
    '      Download-FileFast "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" $zipPath',
    '      $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)',
    '      try {',
    '        foreach ($entry in $zip.Entries) {',
    '          if ($entry.FullName -match "[/\\\\]bin[/\\\\](ffmpeg|ffprobe)\\.exe$") {',
    '            $dest = Join-Path $script:BinDir ($Matches[1] + ".exe")',
    '            $inStream = $entry.Open()',
    '            $outStream = [System.IO.File]::Create($dest)',
    '            try { $inStream.CopyTo($outStream) } finally { $outStream.Dispose(); $inStream.Dispose() }',
    '          }',
    '        }',
    '      } finally { $zip.Dispose() }',
    '      Write-Host "      FFmpeg listo." -ForegroundColor Green',
    '    } finally {',
    '      if (Test-Path $zipPath) { Remove-Item -Force $zipPath -ErrorAction SilentlyContinue }',
    '    }',
    '  }',
    '  $sysNode = Get-Command node.exe -ErrorAction SilentlyContinue',
    '  $sysDeno = Get-Command deno.exe -ErrorAction SilentlyContinue',
    '  if (-not (Test-Path $script:DenoExe) -and -not $sysDeno -and -not $sysNode) {',
    '    Write-Host "[3/3] Preparando motor JS (Deno) para compatibilidad total con YouTube..." -ForegroundColor Cyan',
    '    $denoZip = Join-Path $env:TEMP ("ss_deno_" + [Guid]::NewGuid().ToString("N") + ".zip")',
    '    try {',
    '      Download-FileFast "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" $denoZip',
    '      $zip = [System.IO.Compression.ZipFile]::OpenRead($denoZip)',
    '      try {',
    '        foreach ($entry in $zip.Entries) {',
    '          if ($entry.Name -eq "deno.exe") {',
    '            $inStream = $entry.Open()',
    '            $outStream = [System.IO.File]::Create($script:DenoExe)',
    '            try { $inStream.CopyTo($outStream) } finally { $outStream.Dispose(); $inStream.Dispose() }',
    '            break',
    '          }',
    '        }',
    '      } finally { $zip.Dispose() }',
    '      if (Test-Path $script:DenoExe) { Write-Host "      Motor JS listo." -ForegroundColor Green }',
    '    } catch {',
    '      Write-Host "      Continuando sin Deno portable." -ForegroundColor Yellow',
    '    } finally {',
    '      if (Test-Path $denoZip) { Remove-Item -Force $denoZip -ErrorAction SilentlyContinue }',
    '    }',
    '  }',
    '}',
    '',
    'function Test-PublicHttpUrl([string]$RawUrl) {',
    '  if ([string]::IsNullOrWhiteSpace($RawUrl)) { return $null }',
    '  $trimmed = $RawUrl.Trim()',
    '  if ($trimmed -match "[\\x00-\\x1F\\x7F\\s]") { return $null }',
    '  [System.Uri]$uri = $null',
    '  if (-not [System.Uri]::TryCreate($trimmed, [System.UriKind]::Absolute, [ref]$uri)) { return $null }',
    '  if ($uri.Scheme -ne "http" -and $uri.Scheme -ne "https") { return $null }',
    '  $h = $uri.Host.ToLowerInvariant()',
    '  if ($h -in @("localhost","127.0.0.1","0.0.0.0","::1","[::1]") -or $h.EndsWith(".local") -or $h.EndsWith(".internal")) { return $null }',
    '  if ($h -match "^(10\\.|127\\.|169\\.254\\.|192\\.168\\.)") { return $null }',
    '  if ($h -match "^172\\.(\\d+)\\.") { $oct = [int]$Matches[1]; if ($oct -ge 16 -and $oct -le 31) { return $null } }',
    '  return $uri.AbsoluteUri',
    '}',
    '',
    '$script:Jobs = [hashtable]::Synchronized(@{})',
    '',
    'function Build-YtDlpArgs([string]$SafeUrl) {',
    '  $outTemplate = Join-Path $script:SaveDir "%(title).80s [%(id)s].%(ext)s"',
    '  $ytArgs = @(',
    '    "--no-warnings",',
    '    "--no-playlist",',
    '    "--force-overwrites",',
    '    "--windows-filenames",',
    '    "--newline",',
    '    "--progress",',
    '    "--progress-delta", "0.25",',
    '    "--progress-template", "download:SS_PROG:%(progress._percent_str)s|%(progress._downloaded_bytes_str)s|%(progress._total_bytes_str)s|%(progress._total_bytes_estimate_str)s|%(progress._speed_str)s",',
    '    "--progress-template", "postprocess:SS_POST:%(progress.status)s",',
    '    "--max-filesize", "450M",',
    '    "-f", "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b",',
    '    "--merge-output-format", "mp4",',
    '    "-o", $outTemplate,',
    '    "--print", "after_move:SS_ID:%(id)s",',
    '    "--print", "after_move:SS_TITLE:%(title)s",',
    '    "--print", "after_move:SS_PATH:%(filepath)s"',
    '  )',
    '  if (Test-Path -LiteralPath $script:FfmpegExe) {',
    '    $ytArgs += @("--ffmpeg-location", $script:BinDir)',
    '  }',
    '  if (Test-Path -LiteralPath $script:DenoExe) {',
    '    $ytArgs += @("--js-runtimes", ("deno:" + $script:DenoExe), "--remote-components", "ejs:github")',
    '  } else {',
    '    $sysNode = Get-Command node.exe -ErrorAction SilentlyContinue',
    '    if ($sysNode) {',
    '      $ytArgs += @("--js-runtimes", ("node:" + $sysNode.Source), "--remote-components", "ejs:github")',
    '    }',
    '  }',
    '  $ytArgs += @("--", $SafeUrl)',
    '  return ,$ytArgs',
    '}',
    '',
    'function Resolve-VerifiedMp4Path([string]$RawPath, [string]$VideoId, [string]$CanonicalDir) {',
    '  $prefix = $CanonicalDir + [System.IO.Path]::DirectorySeparatorChar',
    '  if (-not [string]::IsNullOrWhiteSpace($RawPath)) {',
    '    $cand = [System.IO.Path]::GetFullPath($RawPath)',
    '    if ($cand.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.File]::Exists($cand)) {',
    '      return $cand',
    '    }',
    '  }',
    '  if (-not [string]::IsNullOrWhiteSpace($VideoId) -and $VideoId -match "^[a-zA-Z0-9_-]{4,64}$") {',
    '    $files = [System.IO.Directory]::GetFiles($CanonicalDir, "*[" + $VideoId + "]*")',
    '    $best = $files | Where-Object { $_ -match "\\.(mp4|webm|mkv|mov|m4v)$" } | Select-Object -First 1',
    '    if ($best) {',
    '      $cand2 = [System.IO.Path]::GetFullPath($best)',
    '      if ($cand2.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.File]::Exists($cand2)) {',
    '        return $cand2',
    '      }',
    '    }',
    '  }',
    '  return $null',
    '}',
    '',
    'function Start-VideoDownloadJob([string]$RawUrl) {',
    '  $safeUrl = Test-PublicHttpUrl $RawUrl',
    '  if (-not $safeUrl) {',
    '    return @{ ok = $false; status = 400; error = "URL invalida o no permitida." }',
    '  }',
    '  Write-Host "Iniciando descarga MP4 1080p: $safeUrl" -ForegroundColor Cyan',
    '  $jobId = [Guid]::NewGuid().ToString("N")',
    '  $job = [hashtable]::Synchronized(@{',
    '    id = $jobId',
    '    status = "downloading"',
    '    percent = 2',
    '    detail = "Conectando con YouTube..."',
    '    title = ""',
    '    path = ""',
    '    fileName = ""',
    '    size = [long]0',
    '    error = ""',
    '    lastLoggedPct = -1',
    '    ps = $null',
    '  })',
    '  $script:Jobs[$jobId] = $job',
    '  $ytArgs = Build-YtDlpArgs $safeUrl',
    '',
    '  $ps = [PowerShell]::Create()',
    '  [void]$ps.AddScript({',
    '    param($YtExe, $ArgsList, $CanonicalDir, $Job)',
    '    $ErrorActionPreference = "Continue"',
    '    $env:PYTHONUTF8 = "1"',
    '    $env:PYTHONIOENCODING = "utf-8"',
    '    $phase = 1',
    '    $lastRawPct = -1.0',
    '    $idVal = ""',
    '    $titleVal = ""',
    '    $pathVal = ""',
    '    $errLines = New-Object System.Collections.Generic.List[string]',
    '    try {',
    '      & $YtExe @ArgsList 2>&1 | ForEach-Object {',
    '        $line = $_.ToString().Trim()',
    '        if (-not $line) { return }',
    '        if ($line.StartsWith("SS_PROG:")) {',
    '          $parts = $line.Substring(8).Split("|")',
    '          $pctRaw = if ($parts.Length -ge 1) { ($parts[0] -replace "%","").Trim() } else { "" }',
    '          $dlBytes = if ($parts.Length -ge 2) { $parts[1].Trim() } else { "" }',
    '          $totBytes = if ($parts.Length -ge 3) { $parts[2].Trim() } else { "" }',
    '          $estBytes = if ($parts.Length -ge 4) { $parts[3].Trim() } else { "" }',
    '          $speedStr = if ($parts.Length -ge 5) { $parts[4].Trim() } else { "" }',
    '          if (-not $totBytes -or $totBytes -eq "NA" -or $totBytes -eq "N/A") { $totBytes = $estBytes }',
    '',
    '          [double]$rawPct = -1',
    '          [void][double]::TryParse($pctRaw, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$rawPct)',
    '          if ($rawPct -ge 0) {',
    '            if ($phase -eq 1 -and $lastRawPct -ge 80 -and $rawPct -lt 25) { $phase = 2 }',
    '            $lastRawPct = $rawPct',
    '            $mapped = if ($phase -eq 1) { [math]::Round($rawPct * 0.80) } else { [math]::Round(80 + ($rawPct * 0.14)) }',
    '            if ($mapped -gt $Job.percent) { $Job.percent = [int][math]::Min(94, $mapped) }',
    '          }',
    '          $meta = @()',
    '          if ($dlBytes -and $dlBytes -ne "NA" -and $dlBytes -ne "N/A" -and $totBytes -and $totBytes -ne "NA" -and $totBytes -ne "N/A") {',
    '            $meta += "$dlBytes / $totBytes"',
    '          }',
    '          if ($speedStr -and $speedStr -ne "NA" -and $speedStr -ne "N/A") { $meta += $speedStr }',
    '          $suffix = if ($meta.Count -gt 0) { " (" + ($meta -join " · ") + ")" } else { "" }',
    '          $stage = if ($phase -eq 1) { "Descargando video MP4" } else { "Descargando audio" }',
    '          $Job.detail = "$stage... $($Job.percent)%$suffix"',
    '        } elseif ($line.StartsWith("SS_POST:")) {',
    '          $Job.status = "merging"',
    '          if ($Job.percent -lt 95) { $Job.percent = 95 }',
    '          $Job.detail = "Uniendo video y audio MP4 con FFmpeg... $($Job.percent)%"',
    '        } elseif ($line.StartsWith("SS_ID:")) {',
    '          $idVal = $line.Substring(6).Trim()',
    '        } elseif ($line.StartsWith("SS_TITLE:")) {',
    '          $titleVal = $line.Substring(9).Trim()',
    '        } elseif ($line.StartsWith("SS_PATH:")) {',
    '          $pathVal = $line.Substring(8).Trim()',
    '        } elseif ($line -like "ERROR:*") {',
    '          [void]$errLines.Add($line)',
    '        }',
    '      }',
    '',
    '      if ($LASTEXITCODE -ne 0) {',
    '        $Job.status = "error"',
    '        $Job.error = if ($errLines.Count -gt 0) { ($errLines -join " ") } else { "yt-dlp fallo al descargar este enlace." }',
    '        return',
    '      }',
    '      $prefix = $CanonicalDir + [System.IO.Path]::DirectorySeparatorChar',
    '      $fullPath = $null',
    '      if (-not [string]::IsNullOrWhiteSpace($pathVal)) {',
    '        $cand = [System.IO.Path]::GetFullPath($pathVal)',
    '        if ($cand.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.File]::Exists($cand)) {',
    '          $fullPath = $cand',
    '        }',
    '      }',
    '      if (-not $fullPath -and -not [string]::IsNullOrWhiteSpace($idVal) -and $idVal -match "^[a-zA-Z0-9_-]{4,64}$") {',
    '        $files = [System.IO.Directory]::GetFiles($CanonicalDir, "*[" + $idVal + "]*")',
    '        $best = $files | Where-Object { $_ -match "\\.(mp4|webm|mkv|mov|m4v)$" } | Select-Object -First 1',
    '        if ($best) {',
    '          $cand2 = [System.IO.Path]::GetFullPath($best)',
    '          if ($cand2.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.File]::Exists($cand2)) {',
    '            $fullPath = $cand2',
    '          }',
    '        }',
    '      }',
    '      if (-not $fullPath) {',
    '        $Job.status = "error"',
    '        $Job.error = "No se pudo verificar el archivo guardado en Descargas\\ShortStudio."',
    '        return',
    '      }',
    '      $fi = Get-Item -LiteralPath $fullPath',
    '      $Job.title = if ($titleVal) { $titleVal } else { "Video_YouTube" }',
    '      $Job.path = $fullPath',
    '      $Job.fileName = $fi.Name',
    '      $Job.size = [long]$fi.Length',
    '      $Job.percent = 96',
    '      $Job.detail = "Guardado en PC ($([math]::Round($fi.Length / 1MB, 1)) MB). Cargando al editor..."',
    '      $Job.status = "ready"',
    '    } catch {',
    '      $Job.status = "error"',
    '      $Job.error = $_.Exception.Message',
    '    }',
    '  }).AddArgument($script:YtDlpExe).AddArgument($ytArgs).AddArgument($script:CanonicalSaveDir).AddArgument($job)',
    '  $job.ps = $ps',
    '  [void]$ps.BeginInvoke()',
    '  return @{ ok = $true; job = $job }',
    '}',
    '',
    'function Invoke-VideoDownload([string]$RawUrl) {',
    '  $safeUrl = Test-PublicHttpUrl $RawUrl',
    '  if (-not $safeUrl) {',
    '    return @{ ok = $false; status = 400; error = "URL invalida o no permitida." }',
    '  }',
    '',
    '  Write-Host "Descargando MP4 1080p: $safeUrl" -ForegroundColor Cyan',
    '  $ytArgs = Build-YtDlpArgs $safeUrl',
    '  $prevEap = $ErrorActionPreference',
    '  $ErrorActionPreference = "Continue"',
    '  $idVal = ""',
    '  $titleVal = ""',
    '  $pathVal = ""',
    '  $errLines = New-Object System.Collections.Generic.List[string]',
    '  & $script:YtDlpExe @ytArgs 2>&1 | ForEach-Object {',
    '    $line = $_.ToString().Trim()',
    '    if (-not $line) { return }',
    '    if ($line.StartsWith("SS_PROG:")) {',
    '      $parts = $line.Substring(8).Split("|")',
    '      $pctRaw = if ($parts.Length -ge 1) { $parts[0].Trim() } else { "" }',
    '      $speedStr = if ($parts.Length -ge 5) { $parts[4].Trim() } else { "" }',
    '      $msg = ("  Progreso: " + $pctRaw + " " + $speedStr).PadRight(76)',
    '      Write-Host ("`r" + $msg) -NoNewline -ForegroundColor Cyan',
    '    } elseif ($line.StartsWith("SS_POST:")) {',
    '      Write-Host ("`r" + ("  Uniendo MP4 con FFmpeg...").PadRight(76)) -NoNewline -ForegroundColor Cyan',
    '    } elseif ($line.StartsWith("SS_ID:")) {',
    '      $idVal = $line.Substring(6).Trim()',
    '    } elseif ($line.StartsWith("SS_TITLE:")) {',
    '      $titleVal = $line.Substring(9).Trim()',
    '    } elseif ($line.StartsWith("SS_PATH:")) {',
    '      $pathVal = $line.Substring(8).Trim()',
    '    } elseif ($line -like "ERROR:*") {',
    '      [void]$errLines.Add($line)',
    '    }',
    '  }',
    '  $exitCode = $LASTEXITCODE',
    '  $ErrorActionPreference = $prevEap',
    '  Write-Host ""',
    '',
    '  if ($exitCode -ne 0) {',
    '    $errLine = if ($errLines.Count -gt 0) { ($errLines -join " ") } else { "yt-dlp fallo al descargar este enlace." }',
    '    Write-Host "Error: $errLine" -ForegroundColor Red',
    '    return @{ ok = $false; status = 422; error = $errLine }',
    '  }',
    '  $fullPath = Resolve-VerifiedMp4Path $pathVal $idVal $script:CanonicalSaveDir',
    '  if (-not $fullPath) {',
    '    return @{ ok = $false; status = 500; error = "No se pudo verificar el archivo guardado en Descargas\\ShortStudio." }',
    '  }',
    '  $fileInfo = Get-Item -LiteralPath $fullPath',
    '  Write-Host "Guardado en PC: $fullPath ($([math]::Round($fileInfo.Length / 1MB, 1)) MB)" -ForegroundColor Green',
    '  return @{ ok = $true; title = $(if ($titleVal) { $titleVal } else { "Video_YouTube" }); path = $fullPath; fileInfo = $fileInfo }',
    '}',
    '',
    'function Send-Json($Res, [int]$Status, $Obj) {',
    '  $json = ($Obj | ConvertTo-Json -Compress -Depth 4)',
    '  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)',
    '  $Res.StatusCode = $Status',
    '  $Res.SendChunked = $false',
    '  $Res.ContentType = "application/json; charset=utf-8"',
    '  $Res.ContentLength64 = $bytes.Length',
    '  $Res.OutputStream.Write($bytes, 0, $bytes.Length)',
    '  $Res.Close()',
    '}',
    '',
    'function Send-Mp4File($Res, [string]$Title, [string]$FullPath) {',
    '  $fileInfo = Get-Item -LiteralPath $FullPath',
    '  $Res.StatusCode = 200',
    '  $Res.SendChunked = $false',
    '  $Res.ContentType = "video/mp4"',
    '  $Res.ContentLength64 = $fileInfo.Length',
    '  $Res.Headers["X-Video-Title"] = [System.Uri]::EscapeDataString($Title)',
    '  $Res.Headers["X-File-Name"] = [System.Uri]::EscapeDataString($fileInfo.Name)',
    '  $Res.Headers["X-Saved-Path"] = [System.Uri]::EscapeDataString($FullPath)',
    '  $fs = [System.IO.File]::OpenRead($FullPath)',
    '  try {',
    '    $fs.CopyTo($Res.OutputStream)',
    '  } finally {',
    '    $fs.Dispose()',
    '    $Res.Close()',
    '  }',
    '}',
    '',
    'function Set-CorsHeaders($Req, $Res) {',
    '  $origin = $Req.Headers["Origin"]',
    '  if ($origin) {',
    '    $allowed = ($AllowedOrigins -contains $origin) -or ($origin -match "^https://ais-(dev|pre)-[a-z0-9-]+-[0-9]+\\.[a-z0-9-]+\\.run\\.app$")',
    '    if ($allowed) {',
    '      $Res.Headers["Access-Control-Allow-Origin"] = $origin',
    '      $Res.Headers["Vary"] = "Origin"',
    '      $Res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"',
    '      $Res.Headers["Access-Control-Allow-Headers"] = "Content-Type, X-ShortStudio-Token, Access-Control-Request-Private-Network"',
    '      $Res.Headers["Access-Control-Expose-Headers"] = "X-Video-Title, X-Saved-Path, X-File-Name"',
    '      $Res.Headers["Access-Control-Allow-Private-Network"] = "true"',
    '      return $true',
    '    }',
    '    Write-Host "[CORS] Origen rechazado: $origin" -ForegroundColor Yellow',
    '    return $false',
    '  }',
    '  return $true',
    '}',
    '',
    'Ensure-Tools',
    '',
    '$listener = New-Object System.Net.HttpListener',
    '$listener.Prefixes.Add("http://127.0.0.1:$Port/")',
    '$listener.Start()',
    '',
    'Write-Host ""',
    'Write-Host "=========================================================" -ForegroundColor DarkCyan',
    'Write-Host "  ShortStudio Conector Local PC activo (Sin Cookies)" -ForegroundColor Green',
    'Write-Host "  Carpeta de descargas: $SaveDir" -ForegroundColor Gray',
    'Write-Host "  Manten esta ventana abierta mientras importas videos." -ForegroundColor Yellow',
    'Write-Host "  Tip: Tambien puedes pegar aqui una URL de YouTube + Enter." -ForegroundColor DarkGray',
    'Write-Host "=========================================================" -ForegroundColor DarkCyan',
    'Write-Host ""',
    '',
    '$asyncCtx = $null',
    'while ($listener.IsListening) {',
    '  if ($null -eq $asyncCtx) {',
    '    $asyncCtx = $listener.BeginGetContext($null, $null)',
    '  }',
    '  if ($asyncCtx.AsyncWaitHandle.WaitOne(150)) {',
    '    $ctx = $null',
    '    try {',
    '      $ctx = $listener.EndGetContext($asyncCtx)',
    '      $asyncCtx = $null',
    '      $req = $ctx.Request',
    '      $res = $ctx.Response',
    '',
    '      $corsOk = Set-CorsHeaders $req $res',
    '      if (-not $corsOk) {',
    '        Send-Json $res 403 @{ error = "Origen no autorizado." }',
    '        continue',
    '      }',
    '',
    '      if ($req.HttpMethod -eq "OPTIONS") {',
    '        $res.StatusCode = 200',
    '        $res.SendChunked = $false',
    '        $res.ContentLength64 = 0',
    '        $res.Headers["Access-Control-Max-Age"] = "600"',
    '        $res.Close()',
    '        continue',
    '      }',
    '',
    '      $tokenHeader = $req.Headers["X-ShortStudio-Token"]',
    '      if ($tokenHeader -ne $ExpectedToken) {',
    '        Write-Host "[AUTH] Token distinto. Cierra esta ventana y abre el .bat recien descargado." -ForegroundColor Yellow',
    '        Send-Json $res 401 @{ error = "Token de sesion invalido." }',
    '        continue',
    '      }',
    '',
    '      $reqPath = $req.Url.AbsolutePath',
    '      if ($req.HttpMethod -eq "GET" -and $reqPath -eq "/health") {',
    '        if (-not $script:LoggedBrowserLink) {',
    '          Write-Host "[CONECTADO] ShortStudio vinculado correctamente." -ForegroundColor Green',
    '          $script:LoggedBrowserLink = $true',
    '        }',
    '        $ffReady = (Test-Path $FfmpegExe) -or [bool](Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)',
    '        Send-Json $res 200 @{',
    '          ok = $true',
    '          saveDir = $SaveDir',
    '          ytdlpReady = (Test-Path $YtDlpExe)',
    '          ffmpegReady = $ffReady',
    '        }',
    '        continue',
    '      }',
    '',
    '      if ($req.HttpMethod -eq "POST" -and $reqPath -eq "/start") {',
    '        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)',
    '        $bodyText = $reader.ReadToEnd()',
    '        $reader.Dispose()',
    '        $body = $bodyText | ConvertFrom-Json',
    '        $started = Start-VideoDownloadJob $body.url',
    '        if (-not $started.ok) {',
    '          Send-Json $res $started.status @{ error = $started.error }',
    '          continue',
    '        }',
    '        Send-Json $res 200 @{ ok = $true; jobId = $started.job.id }',
    '        continue',
    '      }',
    '',
    '      if ($req.HttpMethod -eq "GET" -and $reqPath -match "^/status/([a-f0-9]+)$") {',
    '        $jid = $Matches[1]',
    '        $job = $script:Jobs[$jid]',
    '        if (-not $job) {',
    '          Send-Json $res 404 @{ error = "Trabajo no encontrado." }',
    '          continue',
    '        }',
    '        if ($job.percent -ge 0 -and ($job.percent -ge ($job.lastLoggedPct + 5) -or $job.status -eq "ready")) {',
    '          $job.lastLoggedPct = $job.percent',
    '          if ($job.status -eq "ready") {',
    '            Write-Host ""',
    '            Write-Host "Guardado en PC: $($job.path) ($([math]::Round($job.size / 1MB, 1)) MB)" -ForegroundColor Green',
    '          } else {',
    '            $padded = ("  " + $job.detail).PadRight(76)',
    '            Write-Host ("`r" + $padded) -NoNewline -ForegroundColor Cyan',
    '          }',
    '        }',
    '        if (($job.status -eq "ready" -or $job.status -eq "error") -and $null -ne $job.ps) {',
    '          if ($job.status -eq "error") { Write-Host ""; Write-Host "Error: $($job.error)" -ForegroundColor Red }',
    '          try { $job.ps.Dispose() } catch {}',
    '          $job.ps = $null',
    '        }',
    '        Send-Json $res 200 @{',
    '          status = $job.status',
    '          percent = $job.percent',
    '          detail = $job.detail',
    '          error = $job.error',
    '        }',
    '        continue',
    '      }',
    '',
    '      if ($req.HttpMethod -eq "GET" -and $reqPath -match "^/file/([a-f0-9]+)$") {',
    '        $jid = $Matches[1]',
    '        $job = $script:Jobs[$jid]',
    '        if (-not $job -or $job.status -ne "ready" -or -not [System.IO.File]::Exists($job.path)) {',
    '          Send-Json $res 404 @{ error = "Archivo MP4 no disponible." }',
    '          continue',
    '        }',
    '        Send-Mp4File $res $job.title $job.path',
    '        $script:Jobs.Remove($jid)',
    '        continue',
    '      }',
    '',
    '      if ($req.HttpMethod -eq "POST" -and $reqPath -eq "/download") {',
    '        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)',
    '        $bodyText = $reader.ReadToEnd()',
    '        $reader.Dispose()',
    '        $body = $bodyText | ConvertFrom-Json',
    '        $dl = Invoke-VideoDownload $body.url',
    '        if (-not $dl.ok) {',
    '          Send-Json $res $dl.status @{ error = $dl.error }',
    '          continue',
    '        }',
    '        Send-Mp4File $res $dl.title $dl.path',
    '        continue',
    '      }',
    '',
    '      Send-Json $res 404 @{ error = "Ruta no encontrada." }',
    '    } catch {',
    '      $asyncCtx = $null',
    '      try {',
    '        if ($ctx -and $ctx.Response) {',
    '          Send-Json $ctx.Response 500 @{ error = $_.Exception.Message }',
    '        }',
    '      } catch {}',
    '    }',
    '  }',
    '',
    '  try {',
    '    if ([Console]::KeyAvailable) {',
    '      $pasted = Read-Host',
    '      if (-not [string]::IsNullOrWhiteSpace($pasted)) {',
    '        $dl = Invoke-VideoDownload $pasted',
    '        if ($dl.ok) {',
    '          Start-Process explorer.exe -ArgumentList ("/select,`"" + $dl.path + "`"")',
    '          Write-Host "Listo! Selecciona ese MP4 en ShortStudio con Subir Archivo o arrastralo." -ForegroundColor Cyan',
    '        }',
    '      }',
    '    }',
    '  } catch {}',
    '}',
  ];

  return lines.join('\r\n') + '\r\n';
}

export function downloadWindowsConnectorLauncher(token: string): void {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const script = buildWindowsConnectorScript(token, origin);
  const blob = new Blob([script], { type: 'application/x-bat;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ShortStudio-Conector-Windows.bat';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
