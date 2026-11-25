const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const GITHUB_REPO = process.env.SHORTSTUDIO_UPDATE_REPO || 'elpirinpi/ShortStudio';
const CURRENT_VERSION = app.getVersion() || '1.0.0';
const PORTABLE_EXE_PATH = process.env.PORTABLE_EXECUTABLE_FILE || '';
const IS_PORTABLE = Boolean(PORTABLE_EXE_PATH);

process.env.SHORTSTUDIO_APP_VERSION = CURRENT_VERSION;
process.env.SHORTSTUDIO_UPDATE_REPO = GITHUB_REPO;

let mainWindow = null;
let serverHandle = null;
let checkInterval = null;
let activeDownloadPromise = null;

const updateState = {
  status: 'idle',
  currentVersion: CURRENT_VERSION,
  latestVersion: null,
  releaseName: null,
  releaseNotes: null,
  releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
  downloadUrl: null,
  assetName: null,
  downloadedPath: null,
  progress: 0,
  error: null,
  isPortable: IS_PORTABLE,
  repo: GITHUB_REPO,
  checkedAt: null,
};

function broadcastUpdateState(patch = {}) {
  Object.assign(updateState, patch);
  const snapshot = { ...updateState };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updates:state', snapshot);
  }
  return snapshot;
}

function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isAllowedGitHubDownloadUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'github.com' ||
      host.endsWith('.github.com') ||
      host.endsWith('.githubusercontent.com') ||
      host.endsWith('.windows.net')
    );
  } catch {
    return false;
  }
}

function normalizeVersion(raw) {
  return String(raw || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
}

function compareSemver(a, b) {
  const pa = normalizeVersion(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = normalizeVersion(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function selectWindowsReleaseAsset(assets) {
  if (!Array.isArray(assets)) return null;
  const exeAssets = assets.filter(
    (a) =>
      a &&
      typeof a.name === 'string' &&
      typeof a.browser_download_url === 'string' &&
      /\.exe$/i.test(a.name) &&
      isAllowedGitHubDownloadUrl(a.browser_download_url)
  );
  if (exeAssets.length === 0) return null;

  if (IS_PORTABLE) {
    return (
      exeAssets.find((a) => /portable/i.test(a.name)) ||
      exeAssets.find((a) => /setup/i.test(a.name)) ||
      exeAssets[0]
    );
  }

  return (
    exeAssets.find((a) => /setup/i.test(a.name)) ||
    exeAssets.find((a) => /portable/i.test(a.name)) ||
    exeAssets[0]
  );
}

async function checkForUpdates({ manual = false } = {}) {
  if (
    updateState.status === 'downloading' ||
    updateState.status === 'installing'
  ) {
    return { ...updateState };
  }

  broadcastUpdateState({
    status: 'checking',
    error: null,
    checkedAt: new Date().toISOString(),
  });

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `KellyClipAi-Studio/${CURRENT_VERSION}`,
        },
      }
    );

    if (res.status === 404) {
      return broadcastUpdateState({
        status: 'up-to-date',
        latestVersion: CURRENT_VERSION,
        error: manual ? 'Aún no hay Releases publicados en GitHub.' : null,
      });
    }

    if (!res.ok) {
      throw new Error(`GitHub respondió HTTP ${res.status}`);
    }

    const release = await res.json();
    const latestVersion = normalizeVersion(release.tag_name || release.name);
    const asset = selectWindowsReleaseAsset(release.assets);
    const releaseUrl =
      typeof release.html_url === 'string' && isAllowedExternalUrl(release.html_url)
        ? release.html_url
        : `https://github.com/${GITHUB_REPO}/releases`;

    if (!latestVersion || compareSemver(latestVersion, CURRENT_VERSION) <= 0) {
      return broadcastUpdateState({
        status: 'up-to-date',
        latestVersion: latestVersion || CURRENT_VERSION,
        releaseName: release.name || null,
        releaseNotes: release.body || null,
        releaseUrl,
        downloadUrl: null,
        assetName: null,
        error: null,
      });
    }

    if (!asset) {
      return broadcastUpdateState({
        status: 'up-to-date',
        latestVersion,
        releaseName: release.name || null,
        releaseNotes: release.body || null,
        releaseUrl,
        error: manual
          ? 'Se detectó un Release nuevo, pero aún se está compilando el archivo .exe.'
          : null,
      });
    }

    const safeAssetName = path.basename(asset.name);
    const existingPath = path.join(
      os.tmpdir(),
      'kellyclipai-updates',
      safeAssetName
    );
    const alreadyDownloaded =
      fs.existsSync(existingPath) && fs.statSync(existingPath).size > 1024 * 1024;

    return broadcastUpdateState({
      status: alreadyDownloaded ? 'downloaded' : 'available',
      latestVersion,
      releaseName: release.name || `v${latestVersion}`,
      releaseNotes: release.body || null,
      releaseUrl,
      downloadUrl: asset.browser_download_url,
      assetName: safeAssetName,
      downloadedPath: alreadyDownloaded ? existingPath : null,
      progress: alreadyDownloaded ? 100 : 0,
      error: null,
    });
  } catch (err) {
    return broadcastUpdateState({
      status: manual ? 'error' : 'idle',
      error: manual
        ? err instanceof Error
          ? err.message
          : 'No se pudo comprobar actualizaciones en GitHub.'
        : null,
    });
  }
}

async function downloadUpdate() {
  if (activeDownloadPromise) return activeDownloadPromise;
  if (!updateState.downloadUrl || !updateState.assetName) {
    return { ...updateState };
  }
  if (!isAllowedGitHubDownloadUrl(updateState.downloadUrl)) {
    return broadcastUpdateState({
      status: 'error',
      error: 'La URL de descarga no pertenece a GitHub.',
    });
  }

  activeDownloadPromise = (async () => {
    const targetDir = path.join(os.tmpdir(), 'kellyclipai-updates');
    fs.mkdirSync(targetDir, { recursive: true });
    const safeName = path.basename(updateState.assetName);
    const partPath = path.join(targetDir, `${safeName}.part`);
    const finalPath = path.join(targetDir, safeName);

    broadcastUpdateState({
      status: 'downloading',
      progress: 0,
      error: null,
    });

    try {
      const response = await fetch(updateState.downloadUrl, {
        headers: {
          'User-Agent': `KellyClipAi-Studio/${CURRENT_VERSION}`,
        },
        redirect: 'follow',
      });

      if (!response.ok || !response.body) {
        throw new Error(`No se pudo descargar el instalador (HTTP ${response.status}).`);
      }

      if (response.url && !isAllowedGitHubDownloadUrl(response.url)) {
        throw new Error('Redirección de descarga bloqueada por seguridad.');
      }

      const totalBytes = Number(response.headers.get('content-length') || '0');
      const reader = response.body.getReader();
      const out = fs.createWriteStream(partPath);
      let received = 0;
      let lastBroadcastPct = -1;

      await new Promise((resolve, reject) => {
        out.on('error', reject);
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.byteLength > 0) {
                received += value.byteLength;
                if (!out.write(Buffer.from(value))) {
                  await new Promise((r) => out.once('drain', r));
                }
                if (totalBytes > 0) {
                  const pct = Math.min(99, Math.round((received / totalBytes) * 100));
                  if (pct !== lastBroadcastPct) {
                    lastBroadcastPct = pct;
                    broadcastUpdateState({ progress: pct });
                  }
                }
              }
            }
            out.end(resolve);
          } catch (streamErr) {
            out.destroy();
            reject(streamErr);
          }
        })();
      });

      if (fs.existsSync(finalPath)) {
        fs.unlinkSync(finalPath);
      }
      fs.renameSync(partPath, finalPath);

      return broadcastUpdateState({
        status: 'downloaded',
        downloadedPath: finalPath,
        progress: 100,
        error: null,
      });
    } catch (err) {
      try {
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
      } catch {
        // ignore
      }
      return broadcastUpdateState({
        status: 'error',
        progress: 0,
        error:
          err instanceof Error
            ? err.message
            : 'Error descargando la actualización desde GitHub.',
      });
    } finally {
      activeDownloadPromise = null;
    }
  })();

  return activeDownloadPromise;
}

function escapePsSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function installDownloadedUpdate() {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      error: 'La autoinstalación aplica únicamente en Windows (.exe).',
    };
  }
  if (!updateState.downloadedPath || !fs.existsSync(updateState.downloadedPath)) {
    return {
      ok: false,
      error: 'El archivo de actualización aún no está descargado.',
    };
  }

  broadcastUpdateState({ status: 'installing', error: null });

  const downloadedExe = updateState.downloadedPath;
  const helperScript = path.join(
    os.tmpdir(),
    'kellyclipai-updates',
    `apply-update-${Date.now()}.ps1`
  );

  let scriptBody = '';
  if (IS_PORTABLE && PORTABLE_EXE_PATH) {
    const targetExe = PORTABLE_EXE_PATH;
    const backupExe = `${targetExe}.bak`;
    scriptBody = [
      `$ErrorActionPreference = 'Stop'`,
      `$appPid = ${process.pid}`,
      `$newExe = '${escapePsSingleQuoted(downloadedExe)}'`,
      `$targetExe = '${escapePsSingleQuoted(targetExe)}'`,
      `$backupExe = '${escapePsSingleQuoted(backupExe)}'`,
      `for ($i = 0; $i -lt 40; $i++) {`,
      `  if (-not (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) { break }`,
      `  Start-Sleep -Milliseconds 350`,
      `}`,
      `Start-Sleep -Milliseconds 400`,
      `if (Test-Path -LiteralPath $backupExe) { Remove-Item -LiteralPath $backupExe -Force -ErrorAction SilentlyContinue }`,
      `if (Test-Path -LiteralPath $targetExe) { Move-Item -LiteralPath $targetExe -Destination $backupExe -Force }`,
      `try {`,
      `  Move-Item -LiteralPath $newExe -Destination $targetExe -Force`,
      `  if (Test-Path -LiteralPath $backupExe) { Remove-Item -LiteralPath $backupExe -Force -ErrorAction SilentlyContinue }`,
      `} catch {`,
      `  if ((Test-Path -LiteralPath $backupExe) -and -not (Test-Path -LiteralPath $targetExe)) {`,
      `    Move-Item -LiteralPath $backupExe -Destination $targetExe -Force`,
      `  }`,
      `  throw`,
      `}`,
      `Start-Process -FilePath $targetExe`,
    ].join('\r\n');
  } else {
    const currentExec = process.execPath;
    scriptBody = [
      `$appPid = ${process.pid}`,
      `$installer = '${escapePsSingleQuoted(downloadedExe)}'`,
      `$relaunchExe = '${escapePsSingleQuoted(currentExec)}'`,
      `for ($i = 0; $i -lt 40; $i++) {`,
      `  if (-not (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) { break }`,
      `  Start-Sleep -Milliseconds 350`,
      `}`,
      `Start-Sleep -Milliseconds 400`,
      `$proc = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru`,
      `if ($proc.ExitCode -eq 0 -and (Test-Path -LiteralPath $relaunchExe)) {`,
      `  Start-Process -FilePath $relaunchExe`,
      `}`,
    ].join('\r\n');
  }

  fs.writeFileSync(helperScript, scriptBody, 'utf8');

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', helperScript],
    {
      detached: true,
      stdio: 'ignore',
    }
  );
  child.unref();

  setTimeout(() => {
    app.quit();
  }, 250);

  return { ok: true };
}

async function startEmbeddedBackend() {
  process.env.NODE_ENV = 'production';
  const distDir = path.join(__dirname, 'dist');
  const binDir = path.join(app.getPath('userData'), 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const serverEntry = path.join(__dirname, 'dist-server', 'server.mjs');
  const mod = await import(pathToFileURL(serverEntry).href);
  if (typeof mod.startServer !== 'function') {
    throw new Error('No se encontró startServer en dist-server/server.mjs');
  }

  try {
    serverHandle = await mod.startServer({
      port: 47832,
      host: '127.0.0.1',
      distDir,
      binDir,
    });
  } catch {
    serverHandle = await mod.startServer({
      port: 0,
      host: '127.0.0.1',
      distDir,
      binDir,
    });
  }

  return serverHandle.port;
}

function buildAppMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollador' },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Buscar actualizaciones en GitHub',
          click: async () => {
            const state = await checkForUpdates({ manual: true });
            if (state.status === 'available' || state.status === 'downloaded') {
              const res = await dialog.showMessageBox(mainWindow || undefined, {
                type: 'info',
                title: 'Actualización disponible',
                message: `KellyClipAi Studio v${state.latestVersion} está disponible`,
                detail: `Tu versión actual es v${CURRENT_VERSION}. ¿Deseas descargar e instalar la nueva versión desde GitHub ahora?`,
                buttons: ['Actualizar ahora', 'Más tarde'],
                defaultId: 0,
              });
              if (res.response === 0) {
                const dl =
                  state.status === 'downloaded' ? state : await downloadUpdate();
                if (dl.status === 'downloaded') {
                  installDownloadedUpdate();
                }
              }
            } else if (state.status === 'up-to-date') {
              dialog.showMessageBox(mainWindow || undefined, {
                type: 'info',
                title: 'KellyClipAi Studio',
                message: `Ya tienes la última versión (v${CURRENT_VERSION})`,
                detail: state.error || `Repositorio: github.com/${GITHUB_REPO}`,
              });
            } else if (state.status === 'error') {
              dialog.showMessageBox(mainWindow || undefined, {
                type: 'warning',
                title: 'No se pudo comprobar actualizaciones',
                message: state.error || 'Error de conexión con GitHub.',
              });
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Créditos del Desarrollador',
          click: () => {
            dialog.showMessageBox(mainWindow || undefined, {
              type: 'info',
              title: 'KellyClipAi Studio',
              message: `KellyClipAi Studio (ShortStudio) v${CURRENT_VERSION}`,
              detail:
                'Desarrollado por: Kelly Benjamin De La Cruz\n\nEditor profesional de Shorts 9:16 con IA local, FFmpeg y exportación a 30 fps exactos para Windows.',
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('updates:get-state', () => ({ ...updateState }));
ipcMain.handle('updates:check', () => checkForUpdates({ manual: true }));
ipcMain.handle('updates:download', () => downloadUpdate());
ipcMain.handle('updates:install', () => installDownloadedUpdate());
ipcMain.handle('updates:open-release', () => {
  const url = updateState.releaseUrl || `https://github.com/${GITHUB_REPO}/releases`;
  if (isAllowedExternalUrl(url)) {
    return shell.openExternal(url);
  }
  return undefined;
});

async function createWindow() {
  try {
    const port = await startEmbeddedBackend();
    buildAppMenu();

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1100,
      minHeight: 720,
      backgroundColor: '#0b0d11',
      title: `KellyClipAi Studio v${CURRENT_VERSION} — por Kelly Benjamin De La Cruz`,
      icon: path.join(__dirname, 'assets', 'icon.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });

    await mainWindow.loadURL(`http://127.0.0.1:${port}`);

    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void checkForUpdates({ manual: false });
      }, 4000);
      if (checkInterval) clearInterval(checkInterval);
      checkInterval = setInterval(() => {
        void checkForUpdates({ manual: false });
      }, 4 * 60 * 60 * 1000);
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  } catch (err) {
    dialog.showErrorBox(
      'Error iniciando KellyClipAi Studio',
      err instanceof Error ? err.message : String(err)
    );
    app.quit();
  }
}

app.setName('KellyClipAi Studio');

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  if (serverHandle && serverHandle.server) {
    try {
      serverHandle.server.close();
    } catch {
      // ignore
    }
  }
});
