import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AiConfig {
  provider: 'claude' | 'ollama';
  // Claude
  apiKey: string;
  mode: 'fetch' | 'websearch';
  // Ollama
  ollamaUrl: string;
  ollamaModel: string;
  // Shared
  interests: string;
  sites: string[];
}

interface AiEvent {
  title: string;
  date: string;        // YYYY-MM-DD
  time: string | null; // HH:MM or null
  notes: string;
  sourceUrl: string;
}

interface AiImportResult {
  events?: AiEvent[];
  error?: string;
}

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

type ClaudeMessage = { role: string; content: unknown };

// ── Path helper ───────────────────────────────────────────────────────────────

const calendarDataFilePath = (): string =>
  path.join(app.getPath('userData'), 'calendar-data.json');

// ── IPC: save config ──────────────────────────────────────────────────────────

ipcMain.handle('ai-save-config', async (_event, config: AiConfig) => {
  const filePath = calendarDataFilePath();
  let data: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  }
  data._aiConfig = config;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
});

// ── IPC: load config ──────────────────────────────────────────────────────────

ipcMain.handle('ai-load-config', async (): Promise<AiConfig | null> => {
  const filePath = calendarDataFilePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return (data._aiConfig as AiConfig) ?? null;
  } catch { return null; }
});

// ── IPC: run import ───────────────────────────────────────────────────────────

ipcMain.handle('ai-run-import', async (): Promise<AiImportResult> => {
  const filePath = calendarDataFilePath();
  let aiConfig: AiConfig | undefined;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    aiConfig = data._aiConfig as AiConfig;
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

async function buildPageDumps(sites: string[]): Promise<string[]> {
  const dumps: string[] = [];
  for (const url of sites) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: AbortSignal.timeout(15_000),
      });
      const html = await res.text();
      const text = html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50_000);

      const charCount = text.length;
      console.log(`[ai-import] fetched ${url} — ${charCount} chars after strip`);
      if (charCount < 200) {
        console.warn(`[ai-import] WARNING: ${url} returned very little text — likely JS-rendered`);
        dumps.push(`--- SOURCE: ${url} --- [PAGE APPEARS EMPTY — may require JavaScript rendering; only ${charCount} chars found]`);
      } else {
        dumps.push(`--- SOURCE: ${url} ---\n${text}`);
      }
    } catch (e) {
      console.error(`[ai-import] fetch failed for ${url}:`, (e as Error).message);
      dumps.push(`--- SOURCE: ${url} --- [FETCH FAILED: ${(e as Error).message}]`);
    }
  }
  return dumps;
}

function buildFetchPrompt(today: string, interests: string, pageDumps: string[]): string {
  return (
    `Today is ${today}. Extract upcoming calendar events from the page text below.\n` +
    (interests ? `Focus on events related to: ${interests}\n` : '') +
    `\nRules:\n` +
    `- Return ONLY a raw JSON array, no markdown, no prose, no code fences\n` +
    `- Each item must have: title (string), date (YYYY-MM-DD), time ("HH:MM" 24h or null), notes (string), sourceUrl (string)\n` +
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
      const toolResults = response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
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
    max_tokens: 4096,
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

// ── Shared response parser ────────────────────────────────────────────────────

function parseEventText(text: string, source: string): AiImportResult {
  // Strip markdown code fences if the model wrapped its output
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  const match = stripped.match(/\[[\s\S]*\]/);
  if (!match) {
    console.warn(`[ai-import] ${source}: no JSON array found in response`);
    return { events: [] };
  }

  try {
    const raw = JSON.parse(match[0]) as unknown[];
    const events: AiEvent[] = raw
      .filter((e): e is Record<string, unknown> =>
        e !== null &&
        typeof e === 'object' &&
        typeof (e as Record<string, unknown>).title === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(String((e as Record<string, unknown>).date)),
      )
      .map(e => ({
        title:     String(e.title).trim(),
        date:      String(e.date),
        time:      typeof e.time === 'string' && /^\d{2}:\d{2}$/.test(e.time) ? e.time : null,
        notes:     typeof e.notes === 'string' ? e.notes.trim() : '',
        sourceUrl: typeof e.sourceUrl === 'string' ? e.sourceUrl.trim() : '',
      }));
    console.log(`[ai-import] ${source}: parsed ${events.length} valid events (${raw.length} raw)`);
    return { events };
  } catch (err) {
    console.error(`[ai-import] ${source}: JSON parse error:`, err);
    return { error: `${source} returned malformed JSON.` };
  }
}
