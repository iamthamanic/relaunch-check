const elements = {
  phaseList: document.querySelector('#phase-list'),
  metricChecks: document.querySelector('#metric-checks'),
  metricReady: document.querySelector('#metric-ready'),
  metricExternal: document.querySelector('#metric-external'),
  statusChip: document.querySelector('#status-chip'),
  runStatus: document.querySelector('#run-status'),
  runDetail: document.querySelector('#run-detail'),
  signal: document.querySelector('#signal'),
  progress: document.querySelector('#progress-bar'),
  results: document.querySelector('#results'),
  pass: document.querySelector('#count-pass'),
  warn: document.querySelector('#count-warn'),
  fail: document.querySelector('#count-fail'),
  logs: document.querySelector('#log-output')
};

let catalog = [];
let pollTimer = null;

function badgeText(status) {
  if (status === 'ready') return 'Direkt';
  if (status === 'external') return 'Extern';
  return 'Geplant';
}

function renderCatalog() {
  const checks = catalog.flatMap((phase) => phase.checks);
  elements.metricChecks.textContent = checks.length;
  elements.metricReady.textContent = checks.filter((item) => item.status === 'ready').length;
  elements.metricExternal.textContent = checks.filter((item) => item.status === 'external').length;
  elements.phaseList.innerHTML = catalog.map((phase, index) => `
    <article class="phase-card">
      <div class="phase-index">${String(index + 1).padStart(2, '0')} · ${phase.phase}</div>
      <div class="phase-content">
        <h3>${phase.title}</h3>
        <p>${phase.description}</p>
        ${phase.checks.map((check) => `
          <div class="check-row">
            <div class="check-name"><span class="check-id">${check.id}</span><strong>${check.name}</strong></div>
            <span class="badge ${check.status}" title="${check.automation}">${badgeText(check.status)}</span>
          </div>
        `).join('')}
      </div>
    </article>
  `).join('');
}

function setButtonsDisabled(disabled) {
  document.querySelectorAll('[data-run]').forEach((button) => { button.disabled = disabled; });
}

function renderState(state) {
  const running = state.status === 'running';
  setButtonsDisabled(running);
  elements.signal.dataset.state = state.status === 'idle' ? 'idle' : state.status;
  const labels = {
    idle: ['Bereit', 'Noch keine Prüfung gestartet.'],
    running: ['Prüfung läuft', `${state.mode ?? ''} wird ausgeführt …`],
    passed: ['Gate bestanden', `${state.summary?.pass ?? 0} Checks bestanden.`],
    failed: ['Gate blockiert', `${state.summary?.fail ?? state.checks.filter((c) => c.status === 'fail').length} Fehler müssen geprüft werden.`]
  };
  const [title, detail] = labels[state.status] ?? labels.idle;
  elements.runStatus.textContent = title;
  elements.runDetail.textContent = detail;
  elements.statusChip.textContent = state.status === 'idle' ? 'Nicht gestartet' : title;

  const checks = state.checks ?? [];
  const pass = checks.filter((item) => item.status === 'pass').length;
  const warn = checks.filter((item) => item.status === 'warn').length;
  const fail = checks.filter((item) => item.status === 'fail').length;
  elements.pass.textContent = pass;
  elements.warn.textContent = warn;
  elements.fail.textContent = fail;

  const expectedCoreChecks = Math.max(1, catalog.flatMap((phase) => phase.checks).filter((item) => item.status === 'ready').length);
  const progress = state.status === 'idle' ? 0 : state.status === 'running' ? Math.min(92, Math.round((checks.length / expectedCoreChecks) * 100)) : 100;
  elements.progress.style.width = `${progress}%`;

  if (checks.length === 0) {
    elements.results.innerHTML = '<p class="empty">Starte oben eine Prüfung. Ergebnisse erscheinen hier ohne Terminal-Ausgabe.</p>';
  } else {
    elements.results.innerHTML = checks.map((check) => `
      <article class="result-item ${check.status}">
        <span class="result-state">${check.status.toUpperCase()}</span>
        <div><strong>${check.name}</strong><p>${check.message}</p></div>
      </article>
    `).join('');
  }
  const humanLogs = (state.logs ?? []).filter((line) => !line.startsWith('RC_EVENT '));
  elements.logs.textContent = humanLogs.length ? humanLogs.join('\n') : 'Keine zusätzlichen technischen Logs.';
}

async function pollState() {
  const response = await fetch('/api/state', { cache: 'no-store' });
  const state = await response.json();
  renderState(state);
  if (state.status === 'running') {
    pollTimer = setTimeout(pollState, 500);
  }
}

async function startRun(mode) {
  clearTimeout(pollTimer);
  setButtonsDisabled(true);
  elements.signal.dataset.state = 'running';
  elements.runStatus.textContent = 'Prüfung startet';
  elements.runDetail.textContent = 'Der Auftrag wurde angenommen.';
  const response = await fetch(`/api/run/${mode}`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    elements.signal.dataset.state = 'failed';
    elements.runStatus.textContent = 'Start fehlgeschlagen';
    elements.runDetail.textContent = body.error ?? `HTTP ${response.status}`;
    setButtonsDisabled(false);
    return;
  }
  await pollState();
}

async function init() {
  const catalogResponse = await fetch('/api/catalog');
  catalog = await catalogResponse.json();
  renderCatalog();
  document.querySelectorAll('[data-run]').forEach((button) => {
    button.addEventListener('click', () => startRun(button.dataset.run));
  });
  await pollState();
}

init().catch((error) => {
  elements.signal.dataset.state = 'failed';
  elements.runStatus.textContent = 'Dashboard-Fehler';
  elements.runDetail.textContent = error.message;
});
