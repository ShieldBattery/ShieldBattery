const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('SHIELDBATTERY_ELECTRON_API', {
  ipcRenderer: {
    // NOTE(tec27): We pass these specifically both to limit API surface, and also because certain
    // methods disappear if we don't (prototype issues? I dunno)
    invoke: ipcRenderer.invoke.bind(ipcRenderer),
    send: ipcRenderer.send.bind(ipcRenderer),
    on: ipcRenderer.on.bind(ipcRenderer),
    once: ipcRenderer.once.bind(ipcRenderer),
    removeAllListeners: ipcRenderer.removeAllListeners.bind(ipcRenderer),
    removeListener: ipcRenderer.removeListener.bind(ipcRenderer),
  },
  env: { ...process.env },
})
