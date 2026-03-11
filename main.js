const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Suppress Chromium GPU shader disk-cache errors on Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#f5f5f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'hidden',
    frame: false,
    show: false,
  });

  // Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; img-src 'self' file: data:; connect-src 'none';",
        ],
      },
    });
  });

  // Block navigation away from the local app file
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  // Block any attempt to open new windows
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---- Paths & helpers ----

const DATA_PATH = () => path.join(app.getPath('userData'), 'calendar-data.json');
const IMAGES_DIR = () => {
  const dir = path.join(app.getPath('userData'), 'images');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

/** Resolve a relative path under userData and guard against path-traversal. */
function resolveUserDataPath(relPath) {
  const base = path.resolve(app.getPath('userData'));
  const full = path.resolve(base, relPath);
  if (!full.startsWith(base + path.sep)) throw new Error('Invalid path');
  return full;
}

/** Write content to the images dir and return the portable relative path. */
function writeImage(destName, writeFn) {
  const imagesDir = IMAGES_DIR();
  const destPath  = path.resolve(imagesDir, destName);
  if (!destPath.startsWith(imagesDir + path.sep)) throw new Error('Invalid image path');
  writeFn(destPath);
  return 'images/' + path.basename(destPath);
}

// ---- IPC: data persistence ----

ipcMain.handle('load-data', () => {
  const dataPath = DATA_PATH();
  if (!fs.existsSync(dataPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch {
    return {};
  }
});

ipcMain.handle('save-data', (_event, data) => {
  try {
    fs.writeFileSync(DATA_PATH(), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[save-data] write failed:', err);
    throw err;
  }
});

// ---- IPC: image management ----

ipcMain.handle('copy-image', (_event, sourcePath, fileName) => {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.includes(ext)) throw new Error('Unsupported file type');
  return writeImage(`${fileName}${ext}`, (dest) => fs.copyFileSync(sourcePath, dest));
});

ipcMain.handle('save-image-buffer', (_event, buffer, fileName, ext) => {
  if (!ALLOWED_IMAGE_EXTS.includes(ext)) throw new Error('Unsupported file type');
  return writeImage(`${fileName}${ext}`, (dest) => fs.writeFileSync(dest, Buffer.from(buffer)));
});

ipcMain.handle('delete-image', (_event, relPath) => {
  const full = resolveUserDataPath(relPath);
  if (fs.existsSync(full)) fs.unlinkSync(full);
});

ipcMain.handle('resolve-image', (_event, relPath) => {
  return resolveUserDataPath(relPath);
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ---- IPC: window controls ----

ipcMain.on('win-minimize', () => mainWindow.minimize());
ipcMain.on('win-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win-close', () => mainWindow.close());
