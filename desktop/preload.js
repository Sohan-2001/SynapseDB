const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('synapseApi', {
  configure: (config) => ipcRenderer.invoke('synapse:configure', config),
  ping: () => ipcRenderer.invoke('synapse:ping'),
  info: () => ipcRenderer.invoke('synapse:info'),
  push: (table, payload) => ipcRenderer.invoke('synapse:push', { table, payload }),
  query: (query) => ipcRenderer.invoke('synapse:query', { query }),
  schema: (table) => ipcRenderer.invoke('synapse:schema', { table }),
  flush: () => ipcRenderer.invoke('synapse:flush'),
  startServer: () => ipcRenderer.invoke('synapse:start-server'),
});
