const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

process.on('uncaughtException', (err) => {
  console.error('Unhandled Exception in Main Process:', err);
});

let mainWindow = null;
let dbProcess = null;
let currentConfig = {
  host: '127.0.0.1',
  port: 8765,
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'SynapseDB Studio',
    backgroundColor: '#0a0d14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// -------------------------------------------------------------
// TCP Client for SynapseDB Wire Protocol (RESP Framing)
// -------------------------------------------------------------
function executeCommand(cmdStr, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const startTime = process.hrtime();
    const socket = new net.Socket();
    let responseData = Buffer.alloc(0);
    let resolved = false;

    socket.setTimeout(timeoutMs);

    socket.connect(currentConfig.port, currentConfig.host, () => {
      const payload = Buffer.from(cmdStr.trim() + '\r\n', 'utf-8');
      socket.write(payload);
    });

    socket.on('data', (chunk) => {
      responseData = Buffer.concat([responseData, chunk]);
      
      const parsed = tryParseResp(responseData);
      if (parsed !== null && !resolved) {
        resolved = true;
        const diff = process.hrtime(startTime);
        const latencyMs = (diff[0] * 1000 + diff[1] / 1e6).toFixed(3);
        socket.destroy();
        resolve({ ...parsed, latencyMs: parseFloat(latencyMs) });
      }
    });

    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error(`Timeout (${timeoutMs}ms) communicating with SynapseDB at ${currentConfig.host}:${currentConfig.port}`));
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(err);
      }
    });
  });
}

function tryParseResp(buf) {
  if (buf.length < 3) return null;
  const prefix = String.fromCharCode(buf[0]);

  if (prefix === '+' || prefix === '-') {
    const crlfIndex = buf.indexOf('\r\n');
    if (crlfIndex === -1) return null;
    const str = buf.subarray(1, crlfIndex).toString('utf-8');
    return {
      type: prefix === '+' ? 'simple_string' : 'error',
      data: str,
      raw: str,
    };
  }

  if (prefix === ':') {
    const crlfIndex = buf.indexOf('\r\n');
    if (crlfIndex === -1) return null;
    const num = parseInt(buf.subarray(1, crlfIndex).toString('utf-8'), 10);
    return {
      type: 'integer',
      data: num,
      raw: num.toString(),
    };
  }

  if (prefix === '$') {
    const firstCrlf = buf.indexOf('\r\n');
    if (firstCrlf === -1) return null;
    const lenStr = buf.subarray(1, firstCrlf).toString('utf-8');
    const length = parseInt(lenStr, 10);
    
    if (length === -1) {
      return { type: 'null', data: null, raw: 'null' };
    }

    const bodyStart = firstCrlf + 2;
    if (buf.length < bodyStart + length + 2) {
      return null; // Need more data
    }

    const body = buf.subarray(bodyStart, bodyStart + length).toString('utf-8');
    let parsedJson = null;
    try {
      parsedJson = JSON.parse(body);
    } catch (_) {
      parsedJson = body;
    }

    return {
      type: 'bulk_string',
      data: parsedJson,
      raw: body,
    };
  }

  // Fallback: check if line ends with \r\n
  const crlfIndex = buf.indexOf('\r\n');
  if (crlfIndex !== -1) {
    const str = buf.subarray(0, crlfIndex).toString('utf-8');
    return { type: 'raw', data: str, raw: str };
  }

  return null;
}

// -------------------------------------------------------------
// Process Management (Auto-spawn SynapseDB)
// -------------------------------------------------------------
function isServerRunning() {
  return executeCommand('PING', 1000)
    .then(() => true)
    .catch(() => false);
}

function findBinaryPath() {
  const fs = require('fs');
  const candidates = [
    // 1. Packaged directory (same folder as SynapseDB-Studio.exe)
    path.join(path.dirname(process.execPath), 'synapsedb.exe'),
    // 2. Resources directory
    path.join(process.resourcesPath || '', 'synapsedb.exe'),
    // 3. Project root directory
    path.resolve(__dirname, '..', 'synapsedb.exe'),
    path.resolve(__dirname, '..', '..', 'synapsedb.exe'),
    path.resolve(process.cwd(), 'synapsedb.exe'),
    // 4. Target release directory
    path.resolve(__dirname, '..', 'target', 'release', 'synapsedb.exe'),
    path.resolve(__dirname, '..', '..', 'target', 'release', 'synapsedb.exe'),
    path.resolve(process.cwd(), 'target', 'release', 'synapsedb.exe'),
  ];

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

function startLocalEngine() {
  if (dbProcess) {
    return Promise.resolve({ ok: true, message: 'Server process is already active.' });
  }

  const binaryPath = findBinaryPath();
  if (!binaryPath) {
    return Promise.resolve({
      ok: false,
      error: 'synapsedb.exe not found. Please ensure synapsedb.exe is in the app directory or start it manually.',
    });
  }

  const workingDir = path.dirname(binaryPath);
  const dataDir = path.join(workingDir, 'data');

  return new Promise((resolve) => {
    try {
      dbProcess = spawn(binaryPath, [], {
        cwd: workingDir,
        env: {
          ...process.env,
          SYNAPSE_ADDR: `${currentConfig.host}:${currentConfig.port}`,
          SYNAPSE_DATA_DIR: dataDir,
          RUST_LOG: 'info',
        },
        stdio: 'ignore',
        detached: true,
      });

      dbProcess.on('error', (err) => {
        dbProcess = null;
        resolve({ ok: false, error: `Could not start synapsedb.exe: ${err.message}` });
      });

      dbProcess.unref();

      // Poll until responsive
      let retries = 20;
      const check = setInterval(async () => {
        const up = await isServerRunning();
        if (up) {
          clearInterval(check);
          resolve({ ok: true, message: 'SynapseDB server started successfully!' });
        } else if (--retries <= 0) {
          clearInterval(check);
          resolve({ ok: false, error: 'Engine started but did not respond to PING in time.' });
        }
      }, 250);
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

// -------------------------------------------------------------
// IPC Handlers
// -------------------------------------------------------------
ipcMain.handle('synapse:configure', (event, { host, port }) => {
  currentConfig.host = host || '127.0.0.1';
  currentConfig.port = port || 8765;
  return { ok: true, config: currentConfig };
});

ipcMain.handle('synapse:ping', async () => {
  try {
    const res = await executeCommand('PING', 2000);
    return { ok: true, message: res.data, latencyMs: res.latencyMs };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('synapse:info', async () => {
  try {
    const res = await executeCommand('INFO', 3000);
    return { ok: true, info: res.data, latencyMs: res.latencyMs };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('synapse:push', async (event, { table, payload }) => {
  try {
    // Escape or clean single line
    const cleanPayload = payload.replace(/[\r\n]+/g, ' ').trim();
    const cmd = `PUSH ${table} ${cleanPayload}`;
    const res = await executeCommand(cmd, 5000);
    
    if (res.type === 'error') {
      return { ok: false, error: res.data };
    }
    return { ok: true, rowId: res.data, latencyMs: res.latencyMs };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('synapse:query', async (event, { query }) => {
  try {
    const cleanQuery = query.replace(/[\r\n]+/g, ' ').trim();
    const cmd = `QUERY ${cleanQuery}`;
    const res = await executeCommand(cmd, 10000);

    if (res.type === 'error') {
      return { ok: false, error: res.data };
    }
    return { ok: true, result: res.data, latencyMs: res.latencyMs };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('synapse:schema', async (event, { table }) => {
  try {
    const cmd = table ? `SCHEMA ${table}` : `SCHEMA`;
    const res = await executeCommand(cmd, 3000);
    if (res.type === 'error') {
      return { ok: false, error: res.data };
    }
    return { ok: true, schema: res.data, latencyMs: res.latencyMs };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('synapse:flush', async () => {
  try {
    const res = await executeCommand('FLUSH', 5000);
    if (res.type === 'error') {
      return { ok: false, error: res.data };
    }
    return { ok: true, message: res.data, latencyMs: res.latencyMs };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('synapse:start-server', async () => {
  try {
    const alreadyUp = await isServerRunning();
    if (alreadyUp) {
      return { ok: true, message: 'Server is already running and connected.' };
    }
    return await startLocalEngine();
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// App Lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
