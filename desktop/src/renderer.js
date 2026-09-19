// -------------------------------------------------------------
// SynapseDB Studio - Frontend Renderer
// -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Navigation & Header
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const pingLatency = document.getElementById('pingLatency');
  const btnFlush = document.getElementById('btnFlush');
  const btnStartEngine = document.getElementById('btnStartEngine');
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanels = document.querySelectorAll('.tab-panel');

  // DOM Elements - Query Studio
  const modeSql = document.getElementById('modeSql');
  const modeNl = document.getElementById('modeNl');
  const queryInput = document.getElementById('queryInput');
  const btnRunQuery = document.getElementById('btnRunQuery');
  const btnClearQuery = document.getElementById('btnClearQuery');
  const queryStatsBar = document.getElementById('queryStatsBar');
  const statExecTime = document.getElementById('statExecTime');
  const statRowCount = document.getElementById('statRowCount');
  const statChunksScanned = document.getElementById('statChunksScanned');
  const statChunksPruned = document.getElementById('statChunksPruned');
  const statTcpTime = document.getElementById('statTcpTime');
  const tableContainer = document.getElementById('tableContainer');
  const btnExportJson = document.getElementById('btnExportJson');
  const queryChips = document.querySelectorAll('.chip');

  // DOM Elements - Ingestion Lab
  const ingestTable = document.getElementById('ingestTable');
  const ingestPayload = document.getElementById('ingestPayload');
  const btnPushRecord = document.getElementById('btnPushRecord');
  const pushAckCard = document.getElementById('pushAckCard');
  const ackLatency = document.getElementById('ackLatency');
  const ackRowId = document.getElementById('ackRowId');
  const ackTitle = document.getElementById('ackTitle');
  const ackRowLabel = document.getElementById('ackRowLabel');
  const ackBufferDesc = document.getElementById('ackBufferDesc');
  const tmplJson = document.getElementById('tmplJson');
  const tmplBatch = document.getElementById('tmplBatch');
  const tmplSynonym = document.getElementById('tmplSynonym');
  const tmplLog = document.getElementById('tmplLog');
  const btnRunBulk = document.getElementById('btnRunBulk');
  const batchCount = document.getElementById('batchCount');
  const bulkProgressBox = document.getElementById('bulkProgressBox');
  const bulkProgressBar = document.getElementById('bulkProgressBar');
  const bulkProgressText = document.getElementById('bulkProgressText');
  const bulkAvgLatency = document.getElementById('bulkAvgLatency');
  const bulkStatsCard = document.getElementById('bulkStatsCard');
  const bulkTotal = document.getElementById('bulkTotal');
  const bulkMedian = document.getElementById('bulkMedian');

  // DOM Elements - Schema Explorer
  const schemaTablesGrid = document.getElementById('schemaTablesGrid');
  const btnRefreshSchema = document.getElementById('btnRefreshSchema');

  // DOM Elements - Data Browser
  const btnViewTable = document.getElementById('btnViewTable');
  const btnViewJson = document.getElementById('btnViewJson');
  const browserTablePills = document.getElementById('browserTablePills');
  const browserSearchInput = document.getElementById('browserSearchInput');
  const browserLimitSelect = document.getElementById('browserLimitSelect');
  const btnRefreshBrowser = document.getElementById('btnRefreshBrowser');
  const btnCopyBrowserJson = document.getElementById('btnCopyBrowserJson');
  const btnExportCsv = document.getElementById('btnExportCsv');
  const metaTableName = document.getElementById('metaTableName');
  const metaRowCount = document.getElementById('metaRowCount');
  const metaColCount = document.getElementById('metaColCount');
  const metaScanTime = document.getElementById('metaScanTime');
  const browserTableContainer = document.getElementById('browserTableContainer');
  const browserJsonContainer = document.getElementById('browserJsonContainer');
  const browserJsonPre = document.getElementById('browserJsonPre');

  // DOM Elements - Engine Health
  const healthVersion = document.getElementById('healthVersion');
  const btnTestPing = document.getElementById('btnTestPing');
  const engineLogOutput = document.getElementById('engineLogOutput');

  let currentQueryMode = 'SQL'; // 'SQL' or 'NL'
  let latestQueryResult = null;
  let isConnected = false;

  let browserActiveTable = null;
  let browserRows = [];
  let browserCols = [];
  let browserViewMode = 'TABLE';

  // -------------------------------------------------------------
  // 1. Connection Heartbeat & Initialization
  // -------------------------------------------------------------
  async function checkConnection() {
    try {
      const res = await window.synapseApi.ping();
      if (res.ok) {
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Connected to 127.0.0.1:8765';
        pingLatency.textContent = `${res.latencyMs} ms`;
        isConnected = true;
      } else {
        setDisconnected(res.error);
      }
    } catch (e) {
      setDisconnected(e.message);
    }
  }

  function setDisconnected(msg) {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Disconnected';
    pingLatency.textContent = '-- ms';
    isConnected = false;
  }

  async function loadEngineInfo() {
    try {
      const res = await window.synapseApi.info();
      if (res.ok && res.info) {
        const info = res.info;
        healthVersion.textContent = `${info.engine || 'SynapseDB'} v${info.version || '0.1.0'}`;
        appendLog(`Connected to ${info.engine}: WAL=${info.wal}, Storage=${info.storage}`);
      }
    } catch (_) {}
  }

  function appendLog(msg) {
    const ts = new Date().toLocaleTimeString();
    engineLogOutput.textContent += `\n[${ts}] ${msg}`;
    engineLogOutput.scrollTop = engineLogOutput.scrollHeight;
  }

  // Auto-connect and auto-start engine if not running
  async function init() {
    await checkConnection();
    if (!isConnected) {
      appendLog("Engine not detected on port 8765. Attempting to start local synapsedb.exe...");
      try {
        const startRes = await window.synapseApi.startServer();
        if (startRes.ok) {
          appendLog(startRes.message);
          await checkConnection();
        } else {
          appendLog(`Notice: ${startRes.error || startRes.message}`);
        }
      } catch (e) {
        appendLog(`Auto-start notice: ${e.message}`);
      }
    }
    await loadEngineInfo();
  }

  init();
  setInterval(checkConnection, 3000);

  // -------------------------------------------------------------
  // 2. Tab Navigation
  // -------------------------------------------------------------
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.dataset.tab;
      navItems.forEach(n => n.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const panel = document.getElementById(`tab-${targetTab}`);
      if (panel) panel.classList.add('active');

      if (targetTab === 'schemaExplorer') {
        loadSchema();
      } else if (targetTab === 'dataBrowser') {
        loadDataBrowserTables();
      }
    });
  });

  // Start engine button
  btnStartEngine.addEventListener('click', async () => {
    btnStartEngine.disabled = true;
    btnStartEngine.textContent = 'Starting...';
    try {
      const res = await window.synapseApi.startServer();
      appendLog(res.message);
      await checkConnection();
      await loadEngineInfo();
    } catch (e) {
      appendLog(`Failed to start engine: ${e.message}`);
    } finally {
      btnStartEngine.disabled = false;
      btnStartEngine.innerHTML = '<span>▶</span> Start Engine';
    }
  });

  // Flush buffer button
  btnFlush.addEventListener('click', async () => {
    btnFlush.disabled = true;
    try {
      const res = await window.synapseApi.flush();
      if (res.ok) {
        appendLog(`Flushed micro-batch buffers to columnar storage in ${res.latencyMs} ms`);
        checkConnection();
      } else {
        appendLog(`Flush failed: ${res.error}`);
      }
    } catch (e) {
      appendLog(`Flush error: ${e.message}`);
    } finally {
      btnFlush.disabled = false;
    }
  });

  // -------------------------------------------------------------
  // 3. Query Studio
  // -------------------------------------------------------------
  modeSql.addEventListener('click', () => {
    currentQueryMode = 'SQL';
    modeSql.classList.add('active');
    modeNl.classList.remove('active');
    queryInput.placeholder = 'Enter SQL (e.g. SELECT COUNT(*), SUM(amount), AVG(amount) FROM rides WHERE amount > 30)';
  });

  modeNl.addEventListener('click', () => {
    currentQueryMode = 'NL';
    modeNl.classList.add('active');
    modeSql.classList.remove('active');
    queryInput.placeholder = 'Ask in plain English (e.g. Total rides spent where amount > 30, Count of rides)';
  });

  btnClearQuery.addEventListener('click', () => {
    queryInput.value = '';
    queryInput.focus();
  });

  queryChips.forEach(chip => {
    chip.addEventListener('click', () => {
      queryInput.value = chip.dataset.query;
      if (chip.dataset.query.toLowerCase().startsWith('select')) {
        modeSql.click();
      } else {
        modeNl.click();
      }
      runQuery();
    });
  });

  // Keyboard shortcut Ctrl+Enter
  queryInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  });

  btnRunQuery.addEventListener('click', runQuery);

  async function runQuery() {
    const q = queryInput.value.trim();
    if (!q) return;

    btnRunQuery.disabled = true;
    btnRunQuery.innerHTML = '<span>⏳</span> Executing...';

    try {
      const res = await window.synapseApi.query(q);
      if (res.ok && res.result) {
        latestQueryResult = res.result;
        renderQueryResult(res.result, res.latencyMs);
      } else {
        renderQueryError(res.error || 'Unknown query error');
      }
    } catch (e) {
      renderQueryError(e.message);
    } finally {
      btnRunQuery.disabled = false;
      btnRunQuery.innerHTML = '<span>⚡</span> Run Query';
    }
  }

  function renderQueryResult(result, tcpTimeMs) {
    queryStatsBar.classList.remove('hidden');

    const stats = result.stats || {};
    statExecTime.textContent = `${stats.execution_time_us || 0} µs`;
    statRowCount.textContent = result.row_count || 0;
    statChunksScanned.textContent = stats.chunks_scanned || 0;
    statChunksPruned.textContent = stats.chunks_pruned || 0;
    statTcpTime.textContent = `${tcpTimeMs} ms`;

    const cols = result.columns || [];
    const rows = result.rows || [];

    if (cols.length === 0 || rows.length === 0) {
      tableContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✓</div>
          <div class="empty-title">Query returned 0 rows</div>
          <div class="empty-desc">Completed in ${stats.execution_time_us || 0} µs</div>
        </div>`;
      return;
    }

    let html = '<table class="data-table"><thead><tr>';
    cols.forEach(col => {
      html += `<th>${escapeHtml(col)}</th>`;
    });
    html += '</tr></thead><tbody>';

    rows.forEach(row => {
      html += '<tr>';
      cols.forEach(col => {
        const val = row[col];
        const formatted = val !== undefined && val !== null ? val : 'NULL';
        html += `<td>${escapeHtml(String(formatted))}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';

    tableContainer.innerHTML = html;
  }

  function renderQueryError(err) {
    queryStatsBar.classList.remove('hidden');
    statExecTime.textContent = 'Error';
    statRowCount.textContent = '0';
    statChunksScanned.textContent = '0';
    statChunksPruned.textContent = '0';
    statTcpTime.textContent = '--';

    tableContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" style="color: var(--accent-red)">✗</div>
        <div class="empty-title" style="color: var(--accent-red)">Execution Error</div>
        <div class="empty-desc" style="font-family: var(--font-mono)">${escapeHtml(err)}</div>
      </div>`;
  }

  btnExportJson.addEventListener('click', () => {
    if (!latestQueryResult) return;
    navigator.clipboard.writeText(JSON.stringify(latestQueryResult, null, 2));
    showToast('JSON copied to clipboard!', 'success');
    btnExportJson.textContent = 'Copied!';
    setTimeout(() => { btnExportJson.textContent = 'Copy JSON'; }, 1500);
  });

  // -------------------------------------------------------------
  // 4. Ingestion Lab
  // -------------------------------------------------------------
  tmplJson.addEventListener('click', () => {
    ingestPayload.value = JSON.stringify({
      fare: +(20 + Math.random() * 80).toFixed(2),
      user_id: 1000 + Math.floor(Math.random() * 500),
      driver: ['Alice', 'Bob', 'Charlie', 'Diana'][Math.floor(Math.random() * 4)],
    }, null, 2);
  });

  if (tmplBatch) {
    tmplBatch.addEventListener('click', () => {
      ingestPayload.value = JSON.stringify([
        { fare: 32.50, user_id: 1010, driver: "Alice" },
        { fare: 48.00, user_id: 1011, driver: "Bob" },
        { fare: 19.75, user_id: 1012, driver: "Charlie" }
      ], null, 2);
    });
  }

  tmplSynonym.addEventListener('click', () => {
    ingestPayload.value = JSON.stringify({
      cost: +(15 + Math.random() * 60).toFixed(2),
      user_id: 2000 + Math.floor(Math.random() * 500),
      driver: 'SynonymDriver',
    }, null, 2);
  });

  tmplLog.addEventListener('click', () => {
    const cost = (30 + Math.random() * 70).toFixed(2);
    ingestPayload.value = `Driver Marcus completed airport pickup ride for $${cost}`;
  });

  btnPushRecord.addEventListener('click', async () => {
    const table = ingestTable.value.trim() || 'rides';
    const rawPayload = ingestPayload.value.trim();
    if (!rawPayload) return;

    btnPushRecord.disabled = true;

    // Check if payload is a JSON array batch or multi-line batch
    let batchItems = null;
    if (rawPayload.startsWith('[') && rawPayload.endsWith(']')) {
      try {
        const parsed = JSON.parse(rawPayload);
        if (Array.isArray(parsed) && parsed.length > 0) {
          batchItems = parsed.map(item => typeof item === 'string' ? item : JSON.stringify(item));
        }
      } catch (_) {
        // Fallback to single string if invalid JSON array
      }
    } else {
      const lines = rawPayload.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length > 1 && !rawPayload.startsWith('{')) {
        batchItems = lines;
      }
    }

    if (batchItems && batchItems.length > 1) {
      // CUSTOM BATCH INGESTION
      btnPushRecord.innerHTML = `<span>⏳</span> Pushing Batch (0/${batchItems.length})...`;
      const latencies = [];
      const rowIds = [];
      try {
        for (let i = 0; i < batchItems.length; i++) {
          btnPushRecord.innerHTML = `<span>⏳</span> Pushing Batch (${i + 1}/${batchItems.length})...`;
          const res = await window.synapseApi.push(table, batchItems[i]);
          if (res.ok) {
            latencies.push(res.latencyMs);
            rowIds.push(res.rowId);
          }
        }
        await window.synapseApi.flush();

        pushAckCard.classList.remove('hidden');
        if (ackTitle) ackTitle.textContent = `BATCH ACK (${batchItems.length} Records)`;
        if (ackRowLabel) ackRowLabel.textContent = 'Assigned RowIDs:';
        ackRowId.textContent = `#${rowIds[0]} - #${rowIds[rowIds.length - 1]}`;
        const avgLat = (latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)).toFixed(2);
        ackLatency.textContent = `Avg ${avgLat} ms`;
        if (ackBufferDesc) ackBufferDesc.textContent = 'Appended to active.wal & flushed to columnar storage';
        appendLog(`BATCH PUSH -> ${table}: ${batchItems.length} records (RowIDs #${rowIds[0]}-#${rowIds[rowIds.length - 1]}) in avg ${avgLat} ms`);
      } catch (e) {
        alert(`Batch Push Error: ${e.message}`);
      } finally {
        btnPushRecord.disabled = false;
        btnPushRecord.innerHTML = '<span>📥</span> Push to SynapseDB (Single or Batch)';
      }
    } else {
      // SINGLE RECORD INGESTION
      btnPushRecord.innerHTML = '<span>⏳</span> Appending to WAL...';
      try {
        const res = await window.synapseApi.push(table, rawPayload);
        if (res.ok) {
          pushAckCard.classList.remove('hidden');
          if (ackTitle) ackTitle.textContent = 'WAL DURABLE ACK';
          if (ackRowLabel) ackRowLabel.textContent = 'Assigned 64-bit RowID:';
          ackRowId.textContent = `#${res.rowId}`;
          ackLatency.textContent = `${res.latencyMs} ms`;
          if (ackBufferDesc) ackBufferDesc.textContent = 'Queued for micro-batch columnar ingestion';
          appendLog(`PUSH -> ${table}: RowID #${res.rowId} in ${res.latencyMs} ms`);
        } else {
          alert(`Ingest Error: ${res.error}`);
        }
      } catch (e) {
        alert(`Error: ${e.message}`);
      } finally {
        btnPushRecord.disabled = false;
        btnPushRecord.innerHTML = '<span>📥</span> Push to SynapseDB (Single or Batch)';
      }
    }
  });

  // Workload Generator
  btnRunBulk.addEventListener('click', async () => {
    const count = parseInt(batchCount.value, 10) || 50;
    const table = ingestTable.value.trim() || 'rides';

    btnRunBulk.disabled = true;
    bulkProgressBox.classList.remove('hidden');
    bulkStatsCard.classList.add('hidden');

    const latencies = [];
    const drivers = ['Alice', 'Bob', 'Charlie', 'Diana', 'Evan', 'Fiona'];

    for (let i = 1; i <= count; i++) {
      let payload;
      const r = i % 3;
      if (r === 0) {
        // Structured JSON
        payload = JSON.stringify({
          fare: +(10 + (i % 50) * 2.5).toFixed(2),
          user_id: 1000 + i,
          driver: drivers[i % drivers.length],
        });
      } else if (r === 1) {
        // Synonym alias
        payload = JSON.stringify({
          cost: +(12 + (i % 40) * 1.8).toFixed(2),
          user_id: 2000 + i,
          driver: drivers[i % drivers.length],
        });
      } else {
        // Unstructured messy text
        const amount = (25 + (i % 60) * 1.5).toFixed(2);
        payload = `Driver ${drivers[i % drivers.length]} completed taxi trip for $${amount}`;
      }

      const res = await window.synapseApi.push(table, payload);
      if (res.ok) {
        latencies.push(res.latencyMs);
      }

      // Update progress
      const percent = Math.round((i / count) * 100);
      bulkProgressBar.style.width = `${percent}%`;
      bulkProgressText.textContent = `Ingesting ${i} / ${count}...`;

      const avg = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
      bulkAvgLatency.textContent = `Avg: ${avg} ms`;
    }

    // Flush batch to columnar storage
    await window.synapseApi.flush();

    // Summary stats
    latencies.sort((a, b) => a - b);
    const median = latencies[Math.floor(latencies.length / 2)] || 0;

    bulkTotal.textContent = count;
    bulkMedian.textContent = `${median.toFixed(2)} ms`;
    bulkFlushStatus.textContent = 'Flushed to Columnar';
    bulkStatsCard.classList.remove('hidden');

    appendLog(`Bulk batch of ${count} records completed with median latency ${median.toFixed(2)} ms`);
    btnRunBulk.disabled = false;
  });

  // -------------------------------------------------------------
  // 5. Schema Explorer
  // -------------------------------------------------------------
  btnRefreshSchema.addEventListener('click', loadSchema);

  async function loadSchema() {
    schemaTablesGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⏳</div>
        <div class="empty-title">Loading Tables...</div>
      </div>`;

    try {
      // 1. Get all tables
      const allRes = await window.synapseApi.schema();
      const tables = (allRes.ok && allRes.schema && allRes.schema.tables) ? allRes.schema.tables : ['rides', 'benchmark', 'orders'];

      if (tables.length === 0) {
        schemaTablesGrid.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">▦</div>
            <div class="empty-title">No tables found</div>
            <div class="empty-desc">Push records to automatically evolve table schemas.</div>
          </div>`;
        return;
      }

      let cardsHtml = '';
      for (const t of tables) {
        const tableSchemaRes = await window.synapseApi.schema(t);
        if (tableSchemaRes.ok && tableSchemaRes.schema && !tableSchemaRes.schema.error) {
          const s = tableSchemaRes.schema;
          cardsHtml += `
            <div class="table-card">
              <div class="table-card-header">
                <span class="table-title">${escapeHtml(s.table)}</span>
                <span class="table-row-count">${s.row_count || 0} rows</span>
              </div>
              <div class="col-list">`;
          
          (s.columns || []).forEach(col => {
            const typeClass = (col.type || '').toLowerCase();
            cardsHtml += `
              <div class="col-item">
                <span class="col-name">${escapeHtml(col.name)}</span>
                <span class="col-type ${typeClass}">${escapeHtml(col.type)}</span>
              </div>`;
          });

          cardsHtml += `
              </div>
              <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
                <button class="btn btn-secondary btn-sm" onclick="window.browseTable('${escapeHtml(s.table)}')">
                  Browse Data ➔
                </button>
              </div>
            </div>`;
        }
      }

      schemaTablesGrid.innerHTML = cardsHtml || `
        <div class="empty-state">
          <div class="empty-icon">▦</div>
          <div class="empty-title">No schema discovered yet</div>
          <div class="empty-desc">Push records in the Ingestion Lab to see live schema evolution!</div>
        </div>`;
    } catch (e) {
      schemaTablesGrid.innerHTML = `<div class="empty-state"><div class="empty-desc">${escapeHtml(e.message)}</div></div>`;
    }
  }

  // -------------------------------------------------------------
  // 6. Engine Health
  // -------------------------------------------------------------
  btnTestPing.addEventListener('click', async () => {
    btnTestPing.disabled = true;
    try {
      const res = await window.synapseApi.ping();
      if (res.ok) {
        appendLog(`PING -> PONG (${res.latencyMs} ms)`);
      } else {
        appendLog(`PING Failed: ${res.error}`);
      }
    } catch (e) {
      appendLog(`Ping error: ${e.message}`);
    } finally {
      btnTestPing.disabled = false;
    }
  });

  // -------------------------------------------------------------
  // 7. Data Browser (All Tables & JSON View)
  // -------------------------------------------------------------
  window.browseTable = (tableName) => {
    const dataBrowserNav = document.querySelector('[data-tab="dataBrowser"]');
    if (dataBrowserNav) {
      dataBrowserNav.click();
    }
    loadTableData(tableName);
  };

  btnViewTable.addEventListener('click', () => {
    browserViewMode = 'TABLE';
    btnViewTable.classList.add('active');
    btnViewJson.classList.remove('active');
    browserTableContainer.classList.remove('hidden');
    browserJsonContainer.classList.add('hidden');
  });

  btnViewJson.addEventListener('click', () => {
    browserViewMode = 'JSON';
    btnViewJson.classList.add('active');
    btnViewTable.classList.remove('active');
    browserJsonContainer.classList.remove('hidden');
    browserTableContainer.classList.add('hidden');
  });

  browserSearchInput.addEventListener('input', renderBrowserView);
  browserLimitSelect.addEventListener('change', () => {
    if (browserActiveTable) loadTableData(browserActiveTable);
  });
  btnRefreshBrowser.addEventListener('click', () => {
    loadDataBrowserTables();
    if (browserActiveTable) loadTableData(browserActiveTable);
  });

  btnCopyBrowserJson.addEventListener('click', () => {
    if (!browserRows.length) return;
    navigator.clipboard.writeText(browserJsonPre.textContent);
    showToast('JSON copied to clipboard!', 'success');
    btnCopyBrowserJson.innerHTML = '<span>✓</span> Copied!';
    setTimeout(() => { btnCopyBrowserJson.innerHTML = '<span>📋</span> Copy JSON'; }, 1500);
  });

  btnExportCsv.addEventListener('click', () => {
    if (!browserCols.length || !browserRows.length) return;
    let csv = browserCols.map(c => `"${c.replace(/"/g, '""')}"`).join(',') + '\r\n';
    browserRows.forEach(row => {
      csv += browserCols.map(c => {
        const v = row[c] !== null && row[c] !== undefined ? String(row[c]) : '';
        return `"${v.replace(/"/g, '""')}"`;
      }).join(',') + '\r\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${browserActiveTable || 'table'}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported successfully!', 'success');
  });

  async function loadDataBrowserTables() {
    try {
      const res = await window.synapseApi.schema();
      const tables = (res.ok && res.schema && res.schema.tables) ? res.schema.tables : [];

      if (tables.length === 0) {
        browserTablePills.innerHTML = '<span class="toolbar-hint">No tables found. Push data in Ingestion Lab.</span>';
        browserTableContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">⊞</div>
            <div class="empty-title">No tables found</div>
            <div class="empty-desc">Ingest data in the Ingestion Lab to automatically create tables.</div>
          </div>`;
        browserJsonPre.textContent = '[]';
        return;
      }

      let pillsHtml = '';
      for (const t of tables) {
        const schemaRes = await window.synapseApi.schema(t);
        const count = (schemaRes.ok && schemaRes.schema) ? (schemaRes.schema.row_count || 0) : 0;
        const isActive = t === browserActiveTable ? 'active' : '';
        pillsHtml += `<button class="table-pill ${isActive}" data-table="${escapeHtml(t)}">
          <span>${escapeHtml(t)}</span>
          <span class="pill-count">${count}</span>
        </button>`;
      }
      browserTablePills.innerHTML = pillsHtml;

      browserTablePills.querySelectorAll('.table-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          loadTableData(pill.dataset.table);
        });
      });

      if (!browserActiveTable || !tables.includes(browserActiveTable)) {
        if (tables.length > 0) {
          loadTableData(tables[0]);
        }
      }
    } catch (e) {
      browserTablePills.innerHTML = `<span class="toolbar-hint text-danger">${escapeHtml(e.message)}</span>`;
    }
  }

  async function loadTableData(tableName) {
    if (!tableName) return;
    browserActiveTable = tableName;

    browserTablePills.querySelectorAll('.table-pill').forEach(pill => {
      if (pill.dataset.table === tableName) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });

    const limit = parseInt(browserLimitSelect.value, 10) || 100;
    metaTableName.textContent = tableName;
    metaRowCount.textContent = 'Loading...';

    try {
      const q = `SELECT * FROM ${tableName} LIMIT ${limit}`;
      const res = await window.synapseApi.query(q);

      if (res.ok && res.result) {
        const r = res.result;
        browserRows = r.rows || [];
        browserCols = r.columns || [];

        metaRowCount.textContent = `${browserRows.length} rows`;
        metaColCount.textContent = `${browserCols.length} cols`;
        metaScanTime.textContent = `${(r.stats && r.stats.execution_time_us) || 0} µs`;

        renderBrowserView();
      } else {
        metaRowCount.textContent = '0 rows';
        browserTableContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon" style="color: var(--accent-red)">✗</div>
            <div class="empty-title">Failed to load table data</div>
            <div class="empty-desc">${escapeHtml(res.error || 'Unknown error')}</div>
          </div>`;
        browserJsonPre.textContent = '[]';
      }
    } catch (e) {
      metaRowCount.textContent = 'Error';
      browserTableContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" style="color: var(--accent-red)">✗</div>
          <div class="empty-title">Error</div>
          <div class="empty-desc">${escapeHtml(e.message)}</div>
        </div>`;
      browserJsonPre.textContent = '[]';
    }
  }

  function renderBrowserView() {
    const filter = (browserSearchInput.value || '').trim().toLowerCase();
    let displayRows = browserRows;

    if (filter) {
      displayRows = browserRows.filter(row => {
        return Object.values(row).some(val => 
          String(val !== null && val !== undefined ? val : '').toLowerCase().includes(filter)
        );
      });
    }

    // 1. Render Table View
    if (browserCols.length === 0 || displayRows.length === 0) {
      browserTableContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⊞</div>
          <div class="empty-title">${displayRows.length === 0 && browserRows.length > 0 ? 'No matching rows found' : 'Table is empty'}</div>
          <div class="empty-desc">${displayRows.length === 0 && browserRows.length > 0 ? 'Try adjusting your search filter' : '0 records found in ' + browserActiveTable}</div>
        </div>`;
    } else {
      let html = '<table class="data-table"><thead><tr>';
      html += '<th style="width: 50px; color: var(--text-dim);">#</th>';
      browserCols.forEach(c => {
        html += `<th>${escapeHtml(c)}</th>`;
      });
      html += '</tr></thead><tbody>';

      displayRows.forEach((row, idx) => {
        html += '<tr>';
        html += `<td style="color: var(--text-dim); font-size: 11px;">${idx + 1}</td>`;
        browserCols.forEach(c => {
          const val = row[c];
          let formatted = val;
          let extraClass = '';
          if (val === null || val === undefined) {
            formatted = 'NULL';
            extraClass = 'color: var(--text-dim); font-style: italic;';
          } else if (typeof val === 'number') {
            extraClass = 'color: #38bdf8;';
          }
          html += `<td style="${extraClass}">${escapeHtml(String(formatted))}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      browserTableContainer.innerHTML = html;
    }

    // 2. Render JSON View
    browserJsonPre.textContent = JSON.stringify(displayRows, null, 2);
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  // Mobile sidebar toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebar = document.querySelector('.sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      sidebarOverlay.classList.toggle('open');
    });
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('open');
    });
  }

  // Close sidebar on nav item click (mobile)
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('open');
      }
    });
  });

  // Toast notification system
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }
});
