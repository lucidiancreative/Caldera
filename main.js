const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

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
    },
    titleBarStyle: 'hidden',
    frame: false,
    show: false,
  });

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

// --- userData paths ---
function getDataPath() {
  return path.join(app.getPath('userData'), 'calendar-data.json');
}

function getImagesDir() {
  const dir = path.join(app.getPath('userData'), 'images');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// --- IPC: load data ---
ipcMain.handle('load-data', () => {
  const p = getDataPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
});

// --- IPC: save data ---
ipcMain.handle('save-data', (_event, data) => {
  try {
    fs.writeFileSync(getDataPath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[save-data] write failed:', err);
    throw err;
  }
});

// --- IPC: copy image file to userData/images ---
// fileName = "YYYY-MM-DD-<eventId>" (no extension); extension taken from source
ipcMain.handle('copy-image', (_event, sourcePath, fileName) => {
  const ext = path.extname(sourcePath).toLowerCase();
  const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
  if (!allowed.includes(ext)) throw new Error('Unsupported file type');

  const destName = `${fileName}${ext}`;
  const destPath = path.join(getImagesDir(), destName);
  fs.copyFileSync(sourcePath, destPath);
  return `images/${destName}`;
});

// --- IPC: save image from buffer (paste) ---
ipcMain.handle('save-image-buffer', (_event, buffer, fileName, ext) => {
  const destName = `${fileName}${ext}`;
  const destPath = path.join(getImagesDir(), destName);
  fs.writeFileSync(destPath, Buffer.from(buffer));
  return `images/${destName}`;
});

// --- IPC: delete image ---
ipcMain.handle('delete-image', (_event, relPath) => {
  const base = path.resolve(app.getPath('userData'));
  const full = path.resolve(base, relPath);
  // Guard against path-traversal (e.g. relPath = '../../sensitive')
  if (!full.startsWith(base + path.sep)) return;
  if (fs.existsSync(full)) fs.unlinkSync(full);
});

// --- IPC: get full path for display ---
ipcMain.handle('resolve-image', (_event, relPath) => {
  const base = path.resolve(app.getPath('userData'));
  const full = path.resolve(base, relPath);
  if (!full.startsWith(base + path.sep)) throw new Error('Invalid image path');
  return full;
});

// --- IPC: open file dialog ---
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// --- IPC: window controls ---
ipcMain.on('win-minimize', () => mainWindow.minimize());
ipcMain.on('win-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win-close', () => mainWindow.close());
