const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Suppress Chromium GPU shader disk-cache errors on Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let calderaWindow;

function createCalderaWindow() {
  calderaWindow = new BrowserWindow({
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

  // Lock down resource loading: calendar images are local files or inline data URIs; no remote fetches should ever be needed
  calderaWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; img-src 'self' file: data:; connect-src 'none';",
        ],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer'],
      },
    });
  });

  // Block all navigation except back to the app's own index.html.
  // Checking only 'file://' would still allow navigation to arbitrary local files
  // (e.g. ../../etc/passwd via a crafted link or XSS), so we compare against the
  // exact URL that loadFile() generates.
  const appIndexFileUrl = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
  calderaWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== appIndexFileUrl) event.preventDefault();
  });

  // Block any attempt to open new windows
  calderaWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  calderaWindow.loadFile('index.html');

  calderaWindow.once('ready-to-show', () => {
    calderaWindow.show();
  });
}

app.whenReady().then(createCalderaWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createCalderaWindow();
});

// ---- Paths & helpers ----

const calendarDataFilePath = () => path.join(app.getPath('userData'), 'calendar-data.json');
const calendarImagesDir = () => {
  const imagesDirPath = path.join(app.getPath('userData'), 'images');
  if (!fs.existsSync(imagesDirPath)) fs.mkdirSync(imagesDirPath, { recursive: true });
  return imagesDirPath;
};

const ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

/** relPath arrives via IPC from the renderer — validate it stays inside userData so a crafted path like ../../sensitive can't escape the sandbox.
 *  realpathSync resolves symlinks so a symlink inside userData pointing outside cannot bypass the boundary check. */
function resolveCalendarStoragePath(relPath) {
  const userDataBasePath = fs.realpathSync(path.resolve(app.getPath('userData')));
  const resolvedFullPath = path.resolve(userDataBasePath, relPath);
  if (!resolvedFullPath.startsWith(userDataBasePath + path.sep)) throw new Error('Invalid path');
  try {
    const realPath = fs.realpathSync(resolvedFullPath);
    if (!realPath.startsWith(userDataBasePath + path.sep)) throw new Error('Symlink escapes sandbox');
    return realPath;
  } catch (e) {
    if (e.code === 'ENOENT') return resolvedFullPath; // file not yet written, lexical check above is sufficient
    throw e;
  }
}

/** Returns a relative path (not absolute) so stored image references in calendar-data.json remain valid if userData moves between machines or installs. */
function saveImageToCalendarStore(destName, writeFn) {
  const imagesDirPath = fs.realpathSync(calendarImagesDir()); // resolve symlinks on the images dir itself
  const destAbsPath   = path.resolve(imagesDirPath, destName);
  if (!destAbsPath.startsWith(imagesDirPath + path.sep)) throw new Error('Invalid image path');
  writeFn(destAbsPath);
  return 'images/' + path.basename(destAbsPath);
}

// ---- IPC: data persistence ----

ipcMain.handle('load-data', () => {
  const calendarDataPath = calendarDataFilePath();
  if (!fs.existsSync(calendarDataPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(calendarDataPath, 'utf8'));
  } catch {
    return {};
  }
});

ipcMain.handle('save-data', (_event, data) => {
  try {
    fs.writeFileSync(calendarDataFilePath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[save-data] write failed:', err);
    throw err;
  }
});

// ---- IPC: image management ----

ipcMain.handle('copy-image', (_event, sourcePath, fileName) => {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.includes(ext)) throw new Error('Unsupported file type');
  return saveImageToCalendarStore(`${fileName}${ext}`, (dest) => fs.copyFileSync(sourcePath, dest));
});

ipcMain.handle('save-image-buffer', (_event, buffer, fileName, ext) => {
  if (!ALLOWED_IMAGE_EXTS.includes(ext)) throw new Error('Unsupported file type');
  return saveImageToCalendarStore(`${fileName}${ext}`, (dest) => fs.writeFileSync(dest, Buffer.from(buffer)));
});

ipcMain.handle('delete-image', (_event, relPath) => {
  const resolvedStoragePath = resolveCalendarStoragePath(relPath);
  if (fs.existsSync(resolvedStoragePath)) fs.unlinkSync(resolvedStoragePath);
});

ipcMain.handle('resolve-image', (_event, relPath) => {
  return resolveCalendarStoragePath(relPath);
});

ipcMain.handle('open-file-dialog', async () => {
  const fileDialogResult = await dialog.showOpenDialog(calderaWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (fileDialogResult.canceled || !fileDialogResult.filePaths.length) return null;
  return fileDialogResult.filePaths[0];
});

// ---- AI import (compiled from src/ai-import.ts) ----
require('./dist/ai-import');

// ---- IPC: window controls ----

ipcMain.on('win-minimize', () => calderaWindow.minimize());
ipcMain.on('win-maximize', () => {
  if (calderaWindow.isMaximized()) calderaWindow.unmaximize();
  else calderaWindow.maximize();
});
ipcMain.on('win-close', () => calderaWindow.close());
