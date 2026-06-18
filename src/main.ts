import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Suppress Chromium GPU shader disk-cache errors on Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let calderaWindow: BrowserWindow | null = null;

function createCalderaWindow(): void {
  calderaWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#f5f5f5',
    webPreferences: {
      // __dirname at runtime is dist/ — preload.js is co-located there
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
          "default-src 'self'; img-src 'self' file: data:; font-src 'self' file:; connect-src 'none';",
        ],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer'],
      },
    });
  });

  // Block all navigation except back to the app's own index.html.
  // Checking only 'file://' would still allow navigation to arbitrary local files
  // (e.g. ../../etc/passwd via a crafted link or XSS), so we compare against the
  // exact URL that loadFile() generates. __dirname is dist/, so index.html is one level up.
  const appIndexFileUrl = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  calderaWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== appIndexFileUrl) event.preventDefault();
  });

  // Block any attempt to open new windows
  calderaWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // index.html stays at the project root; main.js is compiled to dist/,
  // so we step one directory up to find it
  calderaWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  calderaWindow.once('ready-to-show', () => {
    calderaWindow!.show();
    // DevTools only in development — app.isPackaged is false when running via `npm start`
    if (!app.isPackaged) calderaWindow!.webContents.openDevTools();
  });
}

app.whenReady().then(createCalderaWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createCalderaWindow();
});

// Paths & helpers

const calendarDataFilePath = (): string => path.join(app.getPath('userData'), 'calendar-data.json');

const calendarImagesDir = (): string => {
  const imagesDirPath = path.join(app.getPath('userData'), 'images');
  if (!fs.existsSync(imagesDirPath)) fs.mkdirSync(imagesDirPath, { recursive: true });
  return imagesDirPath;
};

const ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

/** relPath arrives via IPC from the renderer — validate it stays inside userData so a crafted path like ../../sensitive can't escape the sandbox.
 *  realpathSync resolves symlinks so a symlink inside userData pointing outside cannot bypass the boundary check. */
function resolveCalendarStoragePath(relPath: string): string {
  const userDataBasePath = fs.realpathSync(path.resolve(app.getPath('userData')));
  const resolvedFullPath = path.resolve(userDataBasePath, relPath);
  if (!resolvedFullPath.startsWith(userDataBasePath + path.sep)) throw new Error('Invalid path');
  try {
    const realPath = fs.realpathSync(resolvedFullPath);
    if (!realPath.startsWith(userDataBasePath + path.sep)) throw new Error('Symlink escapes sandbox');
    return realPath;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return resolvedFullPath; // file not yet written, lexical check above is sufficient
    throw e;
  }
}

/** Returns a relative path (not absolute) so stored image references in calendar-data.json remain valid if userData moves between machines or installs. */
function saveImageToCalendarStore(destName: string, writeFn: (dest: string) => void): string {
  const imagesDirPath = fs.realpathSync(calendarImagesDir()); // resolve symlinks on the images dir itself
  const destAbsPath   = path.resolve(imagesDirPath, destName);
  if (!destAbsPath.startsWith(imagesDirPath + path.sep)) throw new Error('Invalid image path');
  writeFn(destAbsPath);
  return 'images/' + path.basename(destAbsPath);
}

// IPC: data persistence

ipcMain.handle('load-data', () => {
  const calendarDataPath = calendarDataFilePath();
  if (!fs.existsSync(calendarDataPath)) return {};
  try {
    const rawText = fs.readFileSync(calendarDataPath, 'utf8');
    const parsed = JSON.parse(rawText);
    // One-time safety copy before the v1→v2 multi-calendar migration rewrites the file.
    if (parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version !== 2) {
      const backupPath = path.join(app.getPath('userData'), 'calendar-data.v1.bak.json');
      if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, rawText, 'utf8');
    }
    return parsed;
  } catch {
    return {};
  }
});

ipcMain.handle('save-data', (_event, data: unknown) => {
  try {
    const filePath = calendarDataFilePath();
    // _aiConfig is owned by the main process (ai-import) and never sent by the renderer.
    // Carry the existing one forward so a routine data save doesn't drop the AI settings.
    const payload = (data && typeof data === 'object') ? { ...(data as Record<string, unknown>) } : data;
    if (payload && typeof payload === 'object' && (payload as Record<string, unknown>)._aiConfig === undefined && fs.existsSync(filePath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (existing && typeof existing === 'object' && existing._aiConfig !== undefined) {
          (payload as Record<string, unknown>)._aiConfig = existing._aiConfig;
        }
      } catch {
        // Unreadable existing file — just write the new payload as-is.
      }
    }
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('[save-data] write failed:', err);
    throw err;
  }
});

// IPC: image management

ipcMain.handle('copy-image', (_event, sourcePath: string, fileName: string) => {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.includes(ext)) throw new Error('Unsupported file type');
  return saveImageToCalendarStore(`${fileName}${ext}`, (dest) => fs.copyFileSync(sourcePath, dest));
});

ipcMain.handle('save-image-buffer', (_event, buffer: number[], fileName: string, ext: string) => {
  if (!ALLOWED_IMAGE_EXTS.includes(ext)) throw new Error('Unsupported file type');
  return saveImageToCalendarStore(`${fileName}${ext}`, (dest) => fs.writeFileSync(dest, Buffer.from(buffer)));
});

ipcMain.handle('delete-image', (_event, relPath: string) => {
  const resolvedStoragePath = resolveCalendarStoragePath(relPath);
  if (fs.existsSync(resolvedStoragePath)) fs.unlinkSync(resolvedStoragePath);
});

ipcMain.handle('resolve-image', (_event, relPath: string) => {
  return resolveCalendarStoragePath(relPath);
});

ipcMain.handle('open-file-dialog', async () => {
  if (!calderaWindow) return null;
  const fileDialogResult = await dialog.showOpenDialog(calderaWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (fileDialogResult.canceled || !fileDialogResult.filePaths.length) return null;
  return fileDialogResult.filePaths[0];
});

// AI import (compiled from src/ai-import.ts, co-located in dist/)
import './ai-import';

// IPC: window controls

ipcMain.on('win-minimize', () => calderaWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (!calderaWindow) return;
  if (calderaWindow.isMaximized()) calderaWindow.unmaximize();
  else calderaWindow.maximize();
});
ipcMain.on('win-close', () => calderaWindow?.close());

// shell is a main-process module — not available in sandboxed preloads, so
// openExternal must be routed through IPC rather than called directly in preload.ts.
ipcMain.on('open-external', (_event, url: string) => {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  shell.openExternal(url);
});
