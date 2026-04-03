const { contextBridge, ipcRenderer, webUtils, shell } = require('electron');

contextBridge.exposeInMainWorld('calAPI', {
  loadData:        ()                      => ipcRenderer.invoke('load-data'),
  saveData:        (data)                  => ipcRenderer.invoke('save-data', data),
  copyImage:       (srcPath, fileName)     => ipcRenderer.invoke('copy-image', srcPath, fileName),
  saveImageBuffer: (buf, fileName, ext)    => ipcRenderer.invoke('save-image-buffer', buf, fileName, ext),
  deleteImage:     (relPath)               => ipcRenderer.invoke('delete-image', relPath),
  resolveImage:    (relPath)               => ipcRenderer.invoke('resolve-image', relPath),
  openFileDialog:  ()                      => ipcRenderer.invoke('open-file-dialog'),
  getPathForFile:  (file)                  => webUtils.getPathForFile(file),
  winMinimize:     ()                      => ipcRenderer.send('win-minimize'),
  winMaximize:     ()                      => ipcRenderer.send('win-maximize'),
  winClose:        ()                      => ipcRenderer.send('win-close'),
  aiSaveConfig:    (config)               => ipcRenderer.invoke('ai-save-config', config),
  aiLoadConfig:    ()                     => ipcRenderer.invoke('ai-load-config'),
  aiRunImport:     ()                     => ipcRenderer.invoke('ai-run-import'),
  openExternal: (url) => {
    let parsed;
    try { parsed = new URL(url); } catch { return; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    shell.openExternal(url);
  },
});
