import { useEffect, useState } from 'react';
import type { AiConfig, AiEvent } from '../../types';
import { DatePicker } from './DatePicker';

const EMPTY_CONFIG: AiConfig = {
  provider: 'claude',
  apiKey: '',
  mode: 'fetch',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: '',
  interests: '',
  sites: [],
  keywords: [],
  dateRangeStart: '',
  dateRangeEnd: '',
};

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export function AiImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (events: AiEvent[]) => void;
}) {
  const [config, setConfig] = useState<AiConfig>(EMPTY_CONFIG);
  const [status, setStatus] = useState<{ message: string; type: string }>({ message: '', type: '' });
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [running, setRunning] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [keywordDraft, setKeywordDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    window.calAPI.aiLoadConfig().then((saved) => {
      if (cancelled) return;
      setConfig(saved ? { ...EMPTY_CONFIG, ...saved } : EMPTY_CONFIG);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (config.provider === 'ollama') {
      void refreshModels();
    }
  }, [config.provider]);

  async function refreshModels() {
    setLoadingModels(true);
    try {
      const models = await window.calAPI.ollamaListModels();
      setOllamaModels(models);
      if (models.length > 0 && !models.includes(config.ollamaModel)) {
        setConfig((current) => ({ ...current, ollamaModel: models[0] || '' }));
      }
    } finally {
      setLoadingModels(false);
    }
  }

  async function save() {
    if (config.provider === 'claude' && !config.apiKey) {
      setStatus({ message: 'Please enter your Anthropic API key.', type: 'error' });
      return;
    }
    if (config.provider === 'openai' && !config.apiKey) {
      setStatus({ message: 'Please enter your OpenAI API key.', type: 'error' });
      return;
    }
    if (config.provider === 'ollama' && !config.ollamaUrl) {
      setStatus({ message: 'Please enter the Ollama endpoint URL.', type: 'error' });
      return;
    }
    if (config.provider === 'ollama' && config.ollamaUrl.startsWith('http://') && !isLocalhostUrl(config.ollamaUrl)) {
      setStatus({ message: 'Warning: Using unencrypted HTTP for a remote Ollama server. Consider using HTTPS.', type: 'warning' });
    } else {
      setStatus({ message: 'Settings saved.', type: '' });
    }
    await window.calAPI.aiSaveConfig(config);
  }

  async function runImport() {
    if (config.provider === 'claude' && !config.apiKey) {
      setStatus({ message: 'Please enter and save your API key first.', type: 'error' });
      return;
    }
    if (config.provider === 'openai' && !config.apiKey) {
      setStatus({ message: 'Please enter and save your API key first.', type: 'error' });
      return;
    }
    if (config.provider === 'ollama' && !config.ollamaUrl) {
      setStatus({ message: 'Please enter the Ollama endpoint URL.', type: 'error' });
      return;
    }

    setRunning(true);
    setStatus({ message: 'Running import… this may take up to 30 seconds.', type: 'loading' });
    try {
      await window.calAPI.aiSaveConfig(config);
      const result = await window.calAPI.aiRunImport();
      if (result.error) {
        setStatus({ message: `Error: ${result.error}`, type: 'error' });
        return;
      }
      if (!result.events?.length) {
        setStatus({ message: 'No events found. Try adjusting your interests or URLs.', type: '' });
        return;
      }
      onImported(result.events);
      onClose();
    } finally {
      setRunning(false);
    }
  }

  const showModeSelector = config.provider === 'claude';
  const fetchMode = config.mode === 'fetch';

  return (
    <div id="ai-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div id="ai-modal">
        <button id="ai-modal-close" onClick={onClose}>&#10005;</button>
        <h2 id="ai-modal-title">Event Import</h2>

        <div className="ai-field-group">
          <label className="ai-label">Provider</label>
          <div className="ai-radio-row">
            {(['claude', 'openai', 'ollama'] as const).map((provider) => (
              <label key={provider} className="ai-radio-label">
                <input
                  type="radio"
                  name="ai-provider"
                  checked={config.provider === provider}
                  onChange={() => setConfig((current) => ({
                    ...current,
                    provider,
                    mode: provider === 'claude' ? current.mode : 'fetch',
                  }))}
                />
                <span>{provider === 'claude' ? 'Claude (Haiku)' : provider === 'openai' ? 'OpenAI' : 'Ollama (local)'}</span>
              </label>
            ))}
          </div>
        </div>

        {(config.provider === 'claude' || config.provider === 'openai') && (
          <div className="ai-panel">
            <div className="ai-field-group">
              <label className="ai-label">{config.provider === 'claude' ? 'Anthropic API Key' : 'OpenAI API Key'}</label>
              <input
                type="password"
                className="ai-input"
                value={config.apiKey}
                placeholder={config.provider === 'claude' ? 'sk-ant-api03-…' : 'sk-...'}
                onChange={(event) => setConfig((current) => ({ ...current, apiKey: event.target.value }))}
              />
            </div>
          </div>
        )}

        {config.provider === 'ollama' && (
          <div className="ai-panel">
            <div className="ai-field-group">
              <label className="ai-label">Ollama Endpoint</label>
              <input
                type="url"
                className="ai-input"
                value={config.ollamaUrl}
                placeholder="http://localhost:11434"
                onChange={(event) => setConfig((current) => ({ ...current, ollamaUrl: event.target.value }))}
              />
            </div>
            <div className="ai-field-group">
              <label className="ai-label">Model</label>
              <div className="ai-model-row">
                <select
                  className="ai-input"
                  value={config.ollamaModel}
                  disabled={loadingModels}
                  onChange={(event) => setConfig((current) => ({ ...current, ollamaModel: event.target.value }))}
                >
                  <option value="">Select a model...</option>
                  {ollamaModels.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
                <button id="ai-refresh-models" type="button" className="ai-btn-icon" onClick={() => void refreshModels()} disabled={loadingModels}>
                  &#8635;
                </button>
              </div>
            </div>
          </div>
        )}

        {showModeSelector && (
          <div id="ai-mode-group" className="ai-field-group">
            <label className="ai-label">Import Mode</label>
            <div className="ai-radio-row">
              <label className="ai-radio-label">
                <input type="radio" name="ai-mode" checked={fetchMode} onChange={() => setConfig((current) => ({ ...current, mode: 'fetch' }))} />
                <span>Fetch my sites</span>
              </label>
              <label className="ai-radio-label">
                <input type="radio" name="ai-mode" checked={!fetchMode} onChange={() => setConfig((current) => ({ ...current, mode: 'websearch' }))} />
                <span>Web Search</span>
              </label>
            </div>
          </div>
        )}

        {fetchMode ? (
          <div className="ai-panel">
            <div className="ai-field-group">
              <label className="ai-label">Event Site URLs</label>
              <div id="ai-url-list">
                {config.sites.map((site) => (
                  <div key={site} className="ai-url-row">
                    <span>{site}</span>
                    <button className="ai-url-remove" onClick={() => setConfig((current) => ({ ...current, sites: current.sites.filter((entry) => entry !== site) }))}>&#10005;</button>
                  </div>
                ))}
              </div>
              <div className="ai-url-add-row">
                <input className="ai-input" type="url" value={urlDraft} placeholder="https://venue.com/events" onChange={(event) => setUrlDraft(event.target.value)} />
                <button
                  className="ai-btn-secondary"
                  onClick={() => {
                    const next = urlDraft.trim();
                    if (!next || config.sites.includes(next)) return;
                    setConfig((current) => ({ ...current, sites: [...current.sites, next] }));
                    setUrlDraft('');
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            <div className="ai-field-group">
              <label className="ai-label">Filter Keywords <span className="ai-label-hint">(optional)</span></label>
              <div id="ai-keyword-list">
                {config.keywords.map((keyword) => (
                  <div key={keyword} className="ai-url-row">
                    <span>{keyword}</span>
                    <button className="ai-url-remove" onClick={() => setConfig((current) => ({ ...current, keywords: current.keywords.filter((entry) => entry !== keyword) }))}>&#10005;</button>
                  </div>
                ))}
              </div>
              <div className="ai-url-add-row">
                <input className="ai-input" type="text" value={keywordDraft} placeholder="jazz, concert, meetup" onChange={(event) => setKeywordDraft(event.target.value)} />
                <button
                  className="ai-btn-secondary"
                  onClick={() => {
                    const next = keywordDraft.trim();
                    if (!next || config.keywords.includes(next)) return;
                    setConfig((current) => ({ ...current, keywords: [...current.keywords, next] }));
                    setKeywordDraft('');
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="ai-panel">
            <div className="ai-field-group">
              <label className="ai-label">Describe your interests</label>
              <textarea
                id="ai-interests-input"
                className="ai-textarea"
                rows={3}
                placeholder="jazz concerts, FC Barcelona matches, local tech meetups…"
                value={config.interests}
                onChange={(event) => setConfig((current) => ({ ...current, interests: event.target.value }))}
              />
            </div>
          </div>
        )}

        <div className="ai-field-group">
          <label className="ai-label">Date Range <span className="ai-label-hint">(optional)</span></label>
          <div className="ai-date-range-row">
            <DatePicker
              value={config.dateRangeStart}
              placeholder="Start date"
              onChange={(next) => setConfig((current) => ({ ...current, dateRangeStart: next }))}
            />
            <span className="ai-date-sep">to</span>
            <DatePicker
              value={config.dateRangeEnd}
              placeholder="End date"
              onChange={(next) => setConfig((current) => ({ ...current, dateRangeEnd: next }))}
            />
          </div>
        </div>

        <div className="ai-modal-actions">
          <button id="ai-save-btn" className="ai-btn-primary" onClick={() => void save()}>Save Settings</button>
          <button id="ai-run-btn" className="ai-btn-primary" disabled={running} onClick={() => void runImport()}>Run Import</button>
        </div>

        <div id="ai-status" className={'ai-status' + (status.type ? ` ${status.type}` : '') + (status.message ? '' : ' hidden')}>
          {status.message}
        </div>
      </div>
    </div>
  );
}
