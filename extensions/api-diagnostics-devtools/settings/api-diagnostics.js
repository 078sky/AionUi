(() => {
  const MAX_WINDOW = 20;
  const state = {
    config: {
      enabled: false,
      outputDir: '',
      sampleIntervalMs: 60000,
    },
    sessionId: '',
    persist: true,
    history: [],
    lastCapture: null,
  };

  const elements = {
    statusBanner: document.getElementById('status-banner'),
    enabled: document.getElementById('enabled'),
    sampleInterval: document.getElementById('sample-interval'),
    outputDir: document.getElementById('output-dir'),
    applyConfig: document.getElementById('apply-config'),
    refreshState: document.getElementById('refresh-state'),
    openOutput: document.getElementById('open-output'),
    sessionId: document.getElementById('session-id'),
    persistSnapshot: document.getElementById('persist-snapshot'),
    captureSnapshot: document.getElementById('capture-snapshot'),
    copySnapshot: document.getElementById('copy-snapshot'),
    summaryRss: document.getElementById('summary-rss'),
    summaryHeap: document.getElementById('summary-heap'),
    summaryTasks: document.getElementById('summary-tasks'),
    summaryCache: document.getElementById('summary-cache'),
    trendWindow: document.getElementById('trend-window'),
    trendGrid: document.getElementById('trend-grid'),
    timeline: document.getElementById('timeline'),
    snapshotMeta: document.getElementById('snapshot-meta'),
    snapshotJson: document.getElementById('snapshot-json'),
  };

  const hostCall = (action, payload) => {
    const requestId = `api-diagnostics-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error(`Host call timed out: ${action}`));
      }, 5000);

      const onMessage = (event) => {
        if (!event || event.source !== window.parent) return;
        const data = event.data;
        if (!data || data.type !== 'ext:api-response' || data.requestId !== requestId) return;

        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(data);
      };

      window.addEventListener('message', onMessage);
      window.parent.postMessage(
        {
          type: 'ext:api-call',
          requestId,
          data: {
            action,
            payload,
          },
        },
        '*'
      );
    });
  };

  const invokeHost = async (action, payload) => {
    const envelope = await hostCall(action, payload);
    if (!envelope || envelope.success !== true) {
      throw new Error((envelope && envelope.error) || `Host bridge failed for ${action}`);
    }

    const bridgeResult = envelope.data;
    if (bridgeResult && typeof bridgeResult === 'object' && Object.prototype.hasOwnProperty.call(bridgeResult, 'success')) {
      if (!bridgeResult.success) {
        throw new Error(bridgeResult.msg || bridgeResult.error || `Request failed for ${action}`);
      }
      return bridgeResult.data;
    }

    return bridgeResult;
  };

  const setStatus = (text, tone) => {
    elements.statusBanner.textContent = text;
    elements.statusBanner.className = 'status';
    if (tone) {
      elements.statusBanner.classList.add(tone);
    }
  };

  const formatTimestamp = (value) => {
    if (!value) return '--';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  };

  const formatMemoryMb = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatCount = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
    return value.toLocaleString();
  };

  const parsePositiveInteger = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return undefined;
    if (!/^\d+$/.test(trimmed)) return undefined;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  const extractSummary = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return null;

    return {
      timestamp: snapshot.timestamp,
      route: snapshot.route,
      reason: snapshot.reason,
      sessionId: snapshot.session && snapshot.session.sessionId ? snapshot.session.sessionId : snapshot.sessionId || null,
      rssBytes: snapshot.process && snapshot.process.memoryUsage ? snapshot.process.memoryUsage.rss : undefined,
      heapUsedBytes: snapshot.process && snapshot.process.memoryUsage ? snapshot.process.memoryUsage.heapUsed : undefined,
      totalTasks: snapshot.runtime && snapshot.runtime.workerManage ? snapshot.runtime.workerManage.totalTasks : undefined,
      messageCacheSize: snapshot.runtime && snapshot.runtime.messageCache ? snapshot.runtime.messageCache.size : undefined,
      inFlightCount: snapshot.runtime && snapshot.runtime.turnCompletion ? snapshot.runtime.turnCompletion.inFlightCount : undefined,
      state: snapshot.session ? snapshot.session.state : null,
    };
  };

  const getDisplayedCapture = () => {
    return state.history[state.history.length - 1] || state.lastCapture;
  };

  const buildSparklinePoints = (values) => {
    if (!values.length) return '';
    if (values.length === 1) return '0,24 100,24';

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 42 - ((value - min) / range) * 28;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  };

  const renderTrendCards = (summaries) => {
    const latest = summaries[summaries.length - 1];
    const previous = summaries[summaries.length - 2];
    const cards = [
      {
        title: 'RSS trend',
        subtitle: 'Resident set size across recent samples.',
        color: '#2563eb',
        values: summaries.map((item) => item.rssBytes || 0),
        latest: latest ? latest.rssBytes : undefined,
        previous: previous ? previous.rssBytes : undefined,
        formatter: formatMemoryMb,
      },
      {
        title: 'Heap used trend',
        subtitle: 'JS heap growth over the latest captures.',
        color: '#d97706',
        values: summaries.map((item) => item.heapUsedBytes || 0),
        latest: latest ? latest.heapUsedBytes : undefined,
        previous: previous ? previous.heapUsedBytes : undefined,
        formatter: formatMemoryMb,
      },
      {
        title: 'Worker task trend',
        subtitle: 'Useful for spotting stop-after task retention.',
        color: '#16a34a',
        values: summaries.map((item) => item.totalTasks || 0),
        latest: latest ? latest.totalTasks : undefined,
        previous: previous ? previous.totalTasks : undefined,
        formatter: formatCount,
      },
      {
        title: 'Cache / in-flight trend',
        subtitle: 'Message cache size paired with active turn residue.',
        color: '#7c3aed',
        values: summaries.map((item) => (item.messageCacheSize || 0) + (item.inFlightCount || 0)),
        latest: latest ? (latest.messageCacheSize || 0) + (latest.inFlightCount || 0) : undefined,
        previous: previous ? (previous.messageCacheSize || 0) + (previous.inFlightCount || 0) : undefined,
        formatter: formatCount,
      },
    ];

    elements.trendGrid.innerHTML = '';

    if (!cards.some((card) => card.values.length)) {
      elements.trendGrid.innerHTML = '<div class="empty">No recent trend data yet. Enable sampling or capture a snapshot to populate the charts.</div>';
      return;
    }

    cards.forEach((card) => {
      const points = buildSparklinePoints(card.values);
      const delta = typeof card.latest === 'number' && typeof card.previous === 'number' ? card.latest - card.previous : null;
      const deltaText = delta === null ? '--' : `${delta > 0 ? '+' : ''}${card.formatter(delta)}`;
      const deltaColor = delta === null ? '#526071' : delta > 0 ? '#dc2626' : delta < 0 ? '#16a34a' : '#526071';

      const article = document.createElement('article');
      article.className = 'trend-card';
      article.innerHTML = `
        <header>
          <div>
            <h3>${card.title}</h3>
            <p>${card.subtitle}</p>
          </div>
          <div class="trend-metric">
            <strong>${card.formatter(card.latest)}</strong>
            <span style="color:${deltaColor}; font-size:12px;">${deltaText}</span>
          </div>
        </header>
        <svg class="sparkline" viewBox="0 0 100 46" aria-hidden="true">
          <line x1="0" y1="36" x2="100" y2="36" stroke="rgba(148,163,184,0.7)" stroke-width="1" stroke-dasharray="4 4"></line>
          <polyline fill="none" points="${points}" stroke="${card.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
        </svg>
      `;
      elements.trendGrid.appendChild(article);
    });
  };

  const renderTimeline = (summaries) => {
    elements.timeline.innerHTML = '';
    if (!summaries.length) {
      elements.timeline.innerHTML = '<div class="empty">No captures recorded in this app run.</div>';
      return;
    }

    summaries
      .slice()
      .reverse()
      .forEach((item) => {
        const entry = document.createElement('article');
        entry.className = 'timeline-item';
        entry.innerHTML = `
          <div>
            <span>Capture</span>
            <h3>${formatTimestamp(item.timestamp)}</h3>
            <p>${[item.route, item.reason, item.sessionId || item.state || null].filter(Boolean).join(' · ') || 'Runtime snapshot'}</p>
          </div>
          <div><span>RSS</span><strong>${formatMemoryMb(item.rssBytes)}</strong></div>
          <div><span>Heap</span><strong>${formatMemoryMb(item.heapUsedBytes)}</strong></div>
          <div><span>Tasks</span><strong>${formatCount(item.totalTasks)}</strong></div>
          <div><span>Cache</span><strong>${formatCount(item.messageCacheSize)}</strong></div>
        `;
        elements.timeline.appendChild(entry);
      });
  };

  const render = () => {
    elements.enabled.checked = !!state.config.enabled;
    elements.sampleInterval.value = state.config.sampleIntervalMs ? String(state.config.sampleIntervalMs) : '';
    elements.outputDir.value = state.config.outputDir || '';
    elements.sessionId.value = state.sessionId || '';
    elements.persistSnapshot.checked = !!state.persist;

    const displayedCapture = getDisplayedCapture();
    const displayedSummary = displayedCapture ? extractSummary(displayedCapture.snapshot) : null;
    const historySummaries = state.history.map((capture) => extractSummary(capture.snapshot)).filter(Boolean).slice(-MAX_WINDOW);

    elements.summaryRss.textContent = displayedSummary ? formatMemoryMb(displayedSummary.rssBytes) : '--';
    elements.summaryHeap.textContent = displayedSummary ? formatMemoryMb(displayedSummary.heapUsedBytes) : '--';
    elements.summaryTasks.textContent = displayedSummary ? formatCount(displayedSummary.totalTasks) : '--';
    elements.summaryCache.textContent = displayedSummary ? formatCount(displayedSummary.messageCacheSize) : '--';
    elements.trendWindow.textContent = `Window: ${historySummaries.length}/${MAX_WINDOW}`;

    renderTrendCards(historySummaries);
    renderTimeline(historySummaries);

    if (displayedCapture) {
      const filePart = displayedCapture.filePath ? ` Last file: ${displayedCapture.filePath}` : '';
      elements.snapshotMeta.textContent = `Last capture: ${formatTimestamp(displayedSummary && displayedSummary.timestamp)}.${filePart}`;
      elements.snapshotJson.value = JSON.stringify(displayedCapture.snapshot, null, 2);
    } else {
      elements.snapshotMeta.textContent = 'No diagnostics snapshot captured yet.';
      elements.snapshotJson.value = '{}';
    }

    elements.copySnapshot.disabled = !displayedCapture;
  };

  const loadState = async () => {
    setStatus('Loading diagnostics state...', null);
    try {
      const [config, history] = await Promise.all([invokeHost('application.getApiDiagnosticsState'), invokeHost('application.getApiDiagnosticsHistory', { limit: MAX_WINDOW })]);
      state.config = {
        enabled: !!(config && config.enabled),
        outputDir: (config && config.outputDir) || '',
        sampleIntervalMs: (config && config.sampleIntervalMs) || 60000,
      };
      state.history = history && Array.isArray(history.captures) ? history.captures : [];
      render();
      setStatus(`Diagnostics ready. Sampling is ${state.config.enabled ? 'enabled' : 'disabled'}.`, 'success');
    } catch (error) {
      console.error('[API Diagnostics Extension] Failed to load state:', error);
      setStatus(error instanceof Error ? error.message : 'Failed to load diagnostics state.', 'error');
    }
  };

  const applyConfig = async () => {
    setStatus('Applying runtime diagnostics config...', null);
    try {
      const nextConfig = await invokeHost('application.updateApiDiagnosticsConfig', {
        enabled: elements.enabled.checked,
        outputDir: elements.outputDir.value.trim(),
        sampleIntervalMs: parsePositiveInteger(elements.sampleInterval.value),
      });

      state.config = {
        enabled: !!(nextConfig && nextConfig.enabled),
        outputDir: (nextConfig && nextConfig.outputDir) || '',
        sampleIntervalMs: (nextConfig && nextConfig.sampleIntervalMs) || 60000,
      };
      render();
      setStatus('Diagnostics config applied for this app run.', 'success');
    } catch (error) {
      console.error('[API Diagnostics Extension] Failed to apply config:', error);
      setStatus(error instanceof Error ? error.message : 'Failed to apply diagnostics config.', 'error');
    }
  };

  const captureSnapshot = async () => {
    setStatus('Capturing runtime snapshot...', null);
    try {
      state.sessionId = elements.sessionId.value.trim();
      state.persist = elements.persistSnapshot.checked;

      const capture = await invokeHost('application.captureApiDiagnosticsSnapshot', {
        sessionId: state.sessionId || undefined,
        persist: state.persist,
      });

      state.lastCapture = capture || null;
      await loadState();
      setStatus(state.persist ? 'Diagnostics snapshot captured and written to disk.' : 'Diagnostics snapshot captured.', 'success');
    } catch (error) {
      console.error('[API Diagnostics Extension] Failed to capture snapshot:', error);
      setStatus(error instanceof Error ? error.message : 'Failed to capture diagnostics snapshot.', 'error');
    }
  };

  const openOutput = async () => {
    const displayedCapture = getDisplayedCapture();
    const targetPath = (displayedCapture && displayedCapture.filePath) || state.config.outputDir;
    if (!targetPath) {
      setStatus('No diagnostics output path is available yet.', 'error');
      return;
    }

    try {
      await invokeHost('shell.showItemInFolder', targetPath);
      setStatus('Opened diagnostics output in the host file manager.', 'success');
    } catch (error) {
      console.error('[API Diagnostics Extension] Failed to open output:', error);
      setStatus(error instanceof Error ? error.message : 'Failed to open diagnostics output.', 'error');
    }
  };

  const copySnapshot = async () => {
    try {
      await navigator.clipboard.writeText(elements.snapshotJson.value || '{}');
      setStatus('Snapshot JSON copied to clipboard.', 'success');
    } catch (error) {
      console.error('[API Diagnostics Extension] Failed to copy snapshot:', error);
      setStatus('Failed to copy snapshot JSON.', 'error');
    }
  };

  elements.applyConfig.addEventListener('click', () => {
    void applyConfig();
  });
  elements.refreshState.addEventListener('click', () => {
    void loadState();
  });
  elements.openOutput.addEventListener('click', () => {
    void openOutput();
  });
  elements.captureSnapshot.addEventListener('click', () => {
    void captureSnapshot();
  });
  elements.copySnapshot.addEventListener('click', () => {
    void copySnapshot();
  });
  elements.sessionId.addEventListener('input', (event) => {
    state.sessionId = event.target.value;
  });
  elements.persistSnapshot.addEventListener('change', (event) => {
    state.persist = event.target.checked;
  });

  window.parent.postMessage({ type: 'aion:get-locale' }, '*');
  void loadState();
})();
