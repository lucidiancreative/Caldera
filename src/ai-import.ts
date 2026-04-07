import { app, ipcMain, BrowserWindow, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { AiConfig, AiEvent, AiImportResult } from './types';

// ── Types (private to ai-import) ─────────────────────────────────────────────

interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ClaudeResponse {
  stop_reason: 'end_turn' | 'tool_use' | string;
  content: ClaudeContentBlock[];
}

interface OllamaResponse {
  message: { role: string; content: string };
  done: boolean;
}

// content can be a plain text string (user prompts) or a structured block array
// (assistant turns with tool_use results). Using unknown here would lose type narrowing
// at every call site, so we keep it broad but explicit.
type ClaudeMessage = { role: 'user' | 'assistant'; content: string | ClaudeContentBlock[] };

// StoredAiConfig is the on-disk shape — apiKey may be encrypted (base64) when _apiKeyEncrypted is true
interface StoredAiConfig extends AiConfig {
  _apiKeyEncrypted?: boolean;
}

// ── Config validation ─────────────────────────────────────────────────────────

// Guards against corrupted or partially-written on-disk configs that would pass
// the StoredAiConfig type assertion but blow up later when fields are accessed.
function isValidStoredAiConfig(stored: unknown): stored is StoredAiConfig {
  if (!stored || typeof stored !== 'object') return false;
  const s = stored as Record<string, unknown>;
  return (
    (s.provider === 'claude' || s.provider === 'ollama') &&
    typeof s.interests === 'string' &&
    Array.isArray(s.sites)
  );
}

// ── Path helper ───────────────────────────────────────────────────────────────

const calendarDataFilePath = (): string =>
  path.join(app.getPath('userData'), 'calendar-data.json');

// ── API key encryption helpers ────────────────────────────────────────────────

function encryptApiKey(plaintext: string): { value: string; encrypted: boolean } {
  if (plaintext && safeStorage.isEncryptionAvailable()) {
    return { value: safeStorage.encryptString(plaintext).toString('base64'), encrypted: true };
  }
  return { value: plaintext, encrypted: false };
}

function decryptApiKey(stored: StoredAiConfig): string {
  if (stored._apiKeyEncrypted && stored.apiKey && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.apiKey, 'base64'));
    } catch {
      return ''; // corrupted or key from different OS user — treat as missing
    }
  }
  return stored.apiKey ?? '';
}

// ── IPC: save config ──────────────────────────────────────────────────────────

ipcMain.handle('ai-save-config', async (_event, config: AiConfig) => {
  const filePath = calendarDataFilePath();
  let data: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  }
  const { value, encrypted } = encryptApiKey(config.apiKey);
  const stored: StoredAiConfig = { ...config, apiKey: value, _apiKeyEncrypted: encrypted };
  data._aiConfig = stored;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
});

// ── IPC: load config ──────────────────────────────────────────────────────────

ipcMain.handle('ai-load-config', async (): Promise<AiConfig | null> => {
  const filePath = calendarDataFilePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const stored = data._aiConfig;
    if (!isValidStoredAiConfig(stored)) return null;
    return { ...stored, apiKey: decryptApiKey(stored), _apiKeyEncrypted: undefined } as AiConfig;
  } catch { return null; }
});

// ── IPC: run import ───────────────────────────────────────────────────────────

ipcMain.handle('ai-run-import', async (): Promise<AiImportResult> => {
  const filePath = calendarDataFilePath();
  let aiConfig: AiConfig | undefined;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const stored = data._aiConfig;
    if (isValidStoredAiConfig(stored)) aiConfig = { ...stored, apiKey: decryptApiKey(stored) } as AiConfig;
  } catch {
    return { error: 'Could not read config.' };
  }
  if (!aiConfig) return { error: 'No AI config found. Save settings first.' };

  if (aiConfig.provider === 'ollama') {
    if (!aiConfig.ollamaUrl) return { error: 'No Ollama endpoint configured.' };
  } else {
    if (!aiConfig.apiKey) return { error: 'No API key configured.' };
  }

  try {
    if (aiConfig.provider === 'ollama') return await runOllamaFetchImport(aiConfig);
    if (aiConfig.mode === 'websearch')   return await runWebSearchImport(aiConfig);
    return await runFetchImport(aiConfig);
  } catch (err) {
    console.error('[ai-run-import]', err);
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// ── Shared: fetch and strip page HTML ─────────────────────────────────────────

// ── Headless page renderer ────────────────────────────────────────────────────
// Uses a hidden BrowserWindow (real Chromium) so JS-rendered SPAs are fully
// populated before we extract text. Each window uses an isolated partition so
// the main app's CSP injection doesn't block external scripts on the target site.

async function renderPage(rawUrl: string): Promise<string> {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  // Reject anything that isn't http or https after normalisation (e.g. file://, ftp://)
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  } catch { return ''; }
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: 'ai-scrape',   // isolated session — no main-app CSP applied
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    let done = false;
    const finish = async (reason: string) => {
      if (done) return;
      done = true;
      try {
        // Extract page text AND anchor hrefs so Claude can return specific event
        // URLs per event rather than just the source site's homepage.
        const [text, linksJson]: [string, string] = await win.webContents.executeJavaScript(`
          (function() {
            const body = document.body;
            if (!body) return ['', '[]'];
            const links = Array.from(body.querySelectorAll('a[href]'))
              .map(a => ({ text: a.innerText.trim().slice(0, 120), href: a.href }))
              .filter(l => l.href.startsWith('http') && l.text.length > 0)
              .slice(0, 300);
            return [body.innerText, JSON.stringify(links)];
          })()
        `);
        const trimmedText  = text.replace(/\s+/g, ' ').trim().slice(0, 45_000);
        const linkSection  = linksJson !== '[]'
          ? `\nLINKS ON PAGE (text → url):\n${
              (JSON.parse(linksJson) as { text: string; href: string }[])
                .map(l => `${l.text} → ${l.href}`)
                .join('\n')
                .slice(0, 5_000)
            }`
          : '';
        const trimmed = (trimmedText + linkSection).slice(0, 50_000);
        console.log(`[ai-import] rendered ${url} (${reason}) — ${trimmedText.length} chars text, ${linksJson.length} chars links`);
        resolve(trimmed);
      } catch {
        resolve('');
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
    };

    // Hard cap: extract whatever rendered within 20s
    const hardTimer = setTimeout(() => finish('timeout'), 20_000);

    win.webContents.on('did-finish-load', () => {
      clearTimeout(hardTimer);
      // Give JS frameworks 2.5s to populate the DOM after initial load
      setTimeout(() => finish('did-finish-load'), 2_500);
    });

    win.webContents.on('did-fail-load', (_e, code) => {
      if (code === -3) return; // ERR_ABORTED = redirect in progress, ignore
      clearTimeout(hardTimer);
      console.error(`[ai-import] load failed for ${url} (code ${code})`);
      resolve('');
      if (!win.isDestroyed()) win.destroy();
    });

    win.loadURL(url).catch(() => {
      clearTimeout(hardTimer);
      resolve('');
      if (!win.isDestroyed()) win.destroy();
    });
  });
}

async function buildPageDumps(sites: string[]): Promise<string[]> {
  // Cap at 3 concurrent hidden BrowserWindows — each uses ~1.6 MB of Chromium memory,
  // so unbounded Promise.all would spike RAM significantly for large site lists.
  // Worker-pool pattern: each worker pulls the next index until the queue is empty.
  const MAX_CONCURRENT_SCRAPERS = 3;
  const results: string[] = new Array(sites.length);
  let nextIndex = 0;

  async function scraperWorker() {
    while (nextIndex < sites.length) {
      const i      = nextIndex++;
      const rawUrl = sites[i];
      const url    = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      const text   = await renderPage(rawUrl);
      results[i]   = text ? `--- SOURCE: ${url} ---\n${text}` : `--- SOURCE: ${url} --- [FAILED TO LOAD]`;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_SCRAPERS, sites.length) }, scraperWorker),
  );
  return results;
}

function buildFetchPrompt(today: string, interests: string, pageDumps: string[]): string {
  return (
    `Today is ${today}. Extract upcoming calendar events from the page text below.\n` +
    (interests ? `Focus on events related to: ${interests}\n` : '') +
    `\nRules:\n` +
    `- Return ONLY a raw JSON array, no markdown, no prose, no code fences\n` +
    `- Each item must have: title (string), date (YYYY-MM-DD), time ("HH:MM" 24h or null), notes (string), sourceUrl (string)\n` +
    `- sourceUrl must be the direct link to that specific event's page — use the LINKS ON PAGE section to find the matching href. Fall back to the source URL only if no specific event link exists.\n` +
    `- Convert all dates to YYYY-MM-DD format. Only include events on or after ${today}.\n` +
    `- If a page says it is empty or JS-rendered, skip it\n` +
    `- If no events are found at all, return []\n\n` +
    pageDumps.join('\n\n')
  );
}

// ── Claude: Fetch mode ────────────────────────────────────────────────────────

async function runFetchImport(aiConfig: AiConfig): Promise<AiImportResult> {
  const today     = new Date().toISOString().split('T')[0];
  const pageDumps = await buildPageDumps(aiConfig.sites ?? []);
  const prompt    = buildFetchPrompt(today, aiConfig.interests, pageDumps);
  const response  = await callClaude(aiConfig.apiKey, [{ role: 'user', content: prompt }]);
  const rawText   = response.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
  console.log('[ai-import] Claude raw response:', rawText.slice(0, 500));
  return parseEventText(rawText, 'Claude');
}

// ── Claude: Web Search mode ───────────────────────────────────────────────────

async function runWebSearchImport(aiConfig: AiConfig): Promise<AiImportResult> {
  const today   = new Date().toISOString().split('T')[0];
  const tools   = [{ type: 'web_search_20250305', name: 'web_search' }];
  const messages: ClaudeMessage[] = [{
    role: 'user',
    content:
      `Today is ${today}. Search the web to find upcoming events matching these interests: "${aiConfig.interests}".\n` +
      `Look for specific events with real dates in the next 60 days.\n` +
      `After searching, return ONLY a JSON array with these keys per event:\n` +
      `  title (string), date (YYYY-MM-DD), time (HH:MM or null), notes (string), sourceUrl (string)\n` +
      `sourceUrl must be the direct URL to that specific event's page (not the site homepage).\n` +
      `Return [] if nothing is found. Do not include any prose outside the JSON array.`,
  }];

  let finalText = '';
  for (let i = 0; i < 5; i++) {
    const response = await callClaude(aiConfig.apiKey, messages, tools);
    if (response.stop_reason === 'end_turn') {
      finalText = response.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
      break;
    }
    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      // Filter out any tool_use blocks that are missing an id — passing undefined
      // as tool_use_id would cause the Claude API to reject the message.
      const toolResults = response.content
        .filter((b): b is ClaudeContentBlock & { id: string } => b.type === 'tool_use' && b.id !== undefined)
        .map(b => ({ type: 'tool_result' as const, tool_use_id: b.id, content: '' }));
      messages.push({ role: 'user', content: toolResults });
    } else {
      break;
    }
  }
  return parseEventText(finalText, 'Claude');
}

// ── Claude API call ───────────────────────────────────────────────────────────

async function callClaude(
  apiKey: string,
  messages: ClaudeMessage[],
  tools?: unknown[],
): Promise<ClaudeResponse> {
  const body: Record<string, unknown> = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    messages,
  };
  if (tools) body.tools = tools;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }
  return res.json() as Promise<ClaudeResponse>;
}

// ── Ollama: Fetch mode ────────────────────────────────────────────────────────

async function runOllamaFetchImport(aiConfig: AiConfig): Promise<AiImportResult> {
  const today     = new Date().toISOString().split('T')[0];
  const pageDumps = await buildPageDumps(aiConfig.sites ?? []);
  const prompt    = buildFetchPrompt(today, aiConfig.interests, pageDumps);
  const text      = await callOllama(aiConfig.ollamaUrl, aiConfig.ollamaModel, prompt);
  console.log('[ai-import] Ollama raw response:', text.slice(0, 500));
  return parseEventText(text, 'Ollama');
}

// ── Ollama API call ───────────────────────────────────────────────────────────

async function callOllama(baseUrl: string, model: string, prompt: string): Promise<string> {
  // Validate the base URL is http or https — blocks file://, custom protocols, etc.
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Ollama URL must use http or https');
    }
  } catch (e) {
    throw new Error(`Invalid Ollama URL: ${e instanceof Error ? e.message : e}`);
  }
  const url = baseUrl.replace(/\/$/, '') + '/api/chat';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama ${res.status}: ${text}`);
  }
  const data = await res.json() as OllamaResponse;
  return data.message?.content ?? '';
}

// ── Event field validation helpers ───────────────────────────────────────────

const MAX_TITLE_LEN  = 200;
const MAX_NOTES_LEN  = 10_000;
const MAX_URL_LEN    = 2_000;

/** Checks that the date string is both well-formed AND represents a real calendar date (e.g. rejects 2024-02-30). */
function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

/** Accepts only http/https URLs; returns '' for anything else (javascript:, file:, relative paths, etc.). */
function sanitizeSourceUrl(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return raw.slice(0, MAX_URL_LEN);
  } catch { return ''; }
}

// ── Shared response parser ────────────────────────────────────────────────────

function tryParseJsonArray(candidate: string): unknown[] | null {
  // First try as-is
  try { return JSON.parse(candidate) as unknown[]; } catch {}
  // Response may be truncated mid-object — try closing it a few ways
  for (const suffix of ['"}]', '}]', ']']) {
    try { return JSON.parse(candidate + suffix) as unknown[]; } catch {}
  }
  return null;
}

function parseEventText(text: string, source: string): AiImportResult {
  // Strip markdown code fences if the model wrapped its output
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');

  // Match a complete array first, fall back to a partial one for truncated responses
  const completeMatch = stripped.match(/\[[\s\S]*\]/);
  const partialMatch  = stripped.match(/\[[\s\S]*/);
  const candidate     = completeMatch?.[0] ?? partialMatch?.[0];

  if (!candidate) {
    console.warn(`[ai-import] ${source}: no JSON array found in response`);
    return { events: [] };
  }

  const raw = tryParseJsonArray(candidate);
  if (!raw) {
    console.error(`[ai-import] ${source}: JSON parse failed even after repair attempts`);
    return { error: `${source} returned malformed JSON.` };
  }

  try {
    const events: AiEvent[] = raw
      .filter((e): e is Record<string, unknown> =>
        e !== null &&
        typeof e === 'object' &&
        typeof (e as Record<string, unknown>).title === 'string' &&
        isValidCalendarDate(String((e as Record<string, unknown>).date)),
      )
      .map(e => ({
        title:     String(e.title).trim().slice(0, MAX_TITLE_LEN),
        date:      String(e.date),
        time:      typeof e.time === 'string' && /^\d{2}:\d{2}$/.test(e.time) ? e.time : null,
        notes:     typeof e.notes === 'string' ? e.notes.trim().slice(0, MAX_NOTES_LEN) : '',
        sourceUrl: typeof e.sourceUrl === 'string' ? sanitizeSourceUrl(e.sourceUrl.trim()) : '',
      }));
    console.log(`[ai-import] ${source}: parsed ${events.length} valid events (${raw.length} raw)`);
    return { events };
  } catch (err) {
    console.error(`[ai-import] ${source}: event mapping error:`, err);
    return { error: `${source} returned malformed JSON.` };
  }
}
