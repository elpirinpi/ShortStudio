const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let mainWindow = null;
let serverHandle = null;

function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
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

  serverHandle = await mod.startServer({
    port: 0,
    host: '127.0.0.1',
    distDir,
    binDir,
  });

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
      label: 'Acerca de',
      submenu: [
        {
          label: 'Créditos del Desarrollador',
          click: () => {
            dialog.showMessageBox(mainWindow || undefined, {
              type: 'info',
              title: 'KellyClipAi Studio',
              message: 'KellyClipAi Studio (ShortStudio) v1.0.0',
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
      title: 'KellyClipAi Studio — por Kelly Benjamin De La Cruz',
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
  if (serverHandle && serverHandle.server) {
    try {
      serverHandle.server.close();
    } catch {
      // ignore
    }
  }
});
