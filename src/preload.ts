import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AiConfig, AiImportResult, CalAPI } from './types';

// Satisfy TypeScript's structural check against CalAPI without importing DOM types.
// webUtils.getPathForFile accepts the same File type Electron defines internally.
type ElectronFile = Parameters<typeof webUtils.getPathForFile>[0];

const calBridge: CalAPI = {
  loadData:        (): Promise<Record<string, unknown>>           => ipcRenderer.invoke('load-data'),
  saveData:        (data: unknown): Promise<void>                 => ipcRenderer.invoke('save-data', data),
  copyImage:       (srcPath: string, fileName: string): Promise<string> =>
                     ipcRenderer.invoke('copy-image', srcPath, fileName),
  saveImageBuffer: (buf: number[], fileName: string, ext: string): Promise<string> =>
                     ipcRenderer.invoke('save-image-buffer', buf, fileName, ext),
  deleteImage:     (relPath: string): Promise<void>               => ipcRenderer.invoke('delete-image', relPath),
  resolveImage:    (relPath: string): Promise<string>             => ipcRenderer.invoke('resolve-image', relPath),
  openFileDialog:  (): Promise<string | null>                     => ipcRenderer.invoke('open-file-dialog'),
  getPathForFile:  (file: object): string                        => webUtils.getPathForFile(file as ElectronFile),
  winMinimize:     (): void => ipcRenderer.send('win-minimize'),
  winMaximize:     (): void => ipcRenderer.send('win-maximize'),
  winClose:        (): void => ipcRenderer.send('win-close'),
  aiSaveConfig:    (config: AiConfig): Promise<void>              => ipcRenderer.invoke('ai-save-config', config),
  aiLoadConfig:    (): Promise<AiConfig | null>                   => ipcRenderer.invoke('ai-load-config'),
  aiRunImport:     (): Promise<AiImportResult>                    => ipcRenderer.invoke('ai-run-import'),
  openExternal: (url: string): void => {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    // Only allow http/https — reject file:, javascript:, and any other scheme.
    // shell is main-process only; route through IPC so sandbox is not violated.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    ipcRenderer.send('open-external', url);
  },
};

contextBridge.exposeInMainWorld('calAPI', calBridge);
