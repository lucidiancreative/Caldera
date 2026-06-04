import type { AiConfig, AiImportResult } from '../types';
import { buildPageDumps } from './renderer';
import { filterEventsByDateRange, parseEventText } from './parse';

type DebugLogger = (...args: unknown[]) => void;

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

interface OpenAIResponse {
  choices: { message: { role: string; content: string } }[];
}

type ClaudeMessage = { role: 'user' | 'assistant'; content: string | ClaudeContentBlock[] };

function getTodayIsoDate(): string {
  return new Date().toISOString().split('T')[0];
}

export function buildFetchPrompt(
  today: string,
  interests: string,
  keywords: string[],
  pageDumps: string[],
  dateRangeStart?: string,
  dateRangeEnd?: string,
): string {
  const keywordRule = keywords.length
    ? `- IMPORTANT: Only include events where the title or description contains at least one of these keywords (case-insensitive): ${keywords.join(', ')}. If no events match these keywords, return []\n`
    : '';
  const rangeStart = dateRangeStart || today;
  const rangeEnd = dateRangeEnd || '';
  const dateRangeRule = rangeEnd
    ? `- Only include events with dates from ${rangeStart} to ${rangeEnd} (inclusive).\n`
    : `- Only include events on or after ${rangeStart}.\n`;

  return (
    `Today is ${today}. Extract upcoming calendar events from the page text below.\n` +
    (interests ? `Focus on events related to: ${interests}\n` : '') +
    `\nRules:\n` +
    `- Return ONLY a raw JSON array, no markdown, no prose, no code fences\n` +
    `- Each item must have: title (string), date (YYYY-MM-DD), time ("HH:MM" 24h or null), notes (string), sourceUrl (string)\n` +
    `- sourceUrl must be the direct link to that specific event's page, NOT the site homepage.\n` +
    `  - Search the LINKS ON PAGE JSON for hrefs matching the event by keyword overlap in the link text.\n` +
    `  - Prefer URLs containing /event/, /show/, /tickets/, /details/, dates, or slugified event names.\n` +
    `  - Avoid short paths like "/" or "/events" - those are listing pages, not event pages.\n` +
    `  - Only fall back to the SOURCE header URL if no specific event link exists.\n` +
    `- Convert all dates to YYYY-MM-DD format.\n` +
    dateRangeRule +
    keywordRule +
    `- If a page says it is empty or JS-rendered, skip it\n` +
    `- If no events are found at all, return []\n\n` +
    pageDumps.join('\n\n')
  );
}

function buildWebSearchPrompt(aiConfig: AiConfig, today: string): string {
  const keywords = aiConfig.keywords ?? [];
  const keywordRule = keywords.length
    ? `\nIMPORTANT: Only include events where the title or description contains at least one of these keywords (case-insensitive): ${keywords.join(', ')}. If no events match these keywords, return [].`
    : '';
  const rangeStart = aiConfig.dateRangeStart || today;
  const rangeEnd = aiConfig.dateRangeEnd || '';
  const dateRangeRule = rangeEnd
    ? `Look for specific events with dates from ${rangeStart} to ${rangeEnd}.\n`
    : `Look for specific events on or after ${rangeStart}.\n`;

  return (
    `Today is ${today}. Search the web to find upcoming events matching these interests: "${aiConfig.interests}".\n` +
    dateRangeRule +
    `After searching, return ONLY a JSON array with these keys per event:\n` +
    `  title (string), date (YYYY-MM-DD), time (HH:MM or null), notes (string), sourceUrl (string)\n\n` +
    `CRITICAL: sourceUrl must be the direct link to that specific event's detail page.\n` +
    `  - Click through search results to find the actual event page URL.\n` +
    `  - Look for URLs containing /event/, /show/, /tickets/, dates, or event IDs.\n` +
    `  - NEVER return homepage URLs like "https://example.com/" or listing pages like "/events".\n` +
    `  - If you cannot find a specific event page URL, omit that event entirely.${keywordRule}\n` +
    `Return [] if nothing is found. Do not include any prose outside the JSON array.`
  );
}

export async function runFetchImport(
  aiConfig: AiConfig,
  options: { debugLog?: DebugLogger } = {},
): Promise<AiImportResult> {
  const today = getTodayIsoDate();
  const pageDumps = await buildPageDumps(aiConfig.sites ?? [], options);
  const prompt = buildFetchPrompt(
    today,
    aiConfig.interests,
    aiConfig.keywords ?? [],
    pageDumps,
    aiConfig.dateRangeStart,
    aiConfig.dateRangeEnd,
  );
  const response = await callClaude(aiConfig.apiKey, [{ role: 'user', content: prompt }]);
  const rawText = response.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('');
  options.debugLog?.('[ai-import] Claude raw response:', rawText.slice(0, 500));
  return filterEventsByDateRange(
    parseEventText(rawText, 'Claude', options),
    aiConfig.dateRangeStart,
    aiConfig.dateRangeEnd,
    options,
  );
}

export async function runWebSearchImport(
  aiConfig: AiConfig,
  options: { debugLog?: DebugLogger } = {},
): Promise<AiImportResult> {
  const today = getTodayIsoDate();
  const tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  const messages: ClaudeMessage[] = [{
    role: 'user',
    content: buildWebSearchPrompt(aiConfig, today),
  }];

  let finalText = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await callClaude(aiConfig.apiKey, messages, tools);
    if (response.stop_reason === 'end_turn') {
      finalText = response.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('');
      break;
    }
    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = response.content
        .filter((block): block is ClaudeContentBlock & { id: string } => block.type === 'tool_use' && block.id !== undefined)
        .map(block => ({ type: 'tool_result' as const, tool_use_id: block.id, content: '' }));
      messages.push({ role: 'user', content: toolResults });
      continue;
    }
    break;
  }

  return filterEventsByDateRange(
    parseEventText(finalText, 'Claude', options),
    aiConfig.dateRangeStart,
    aiConfig.dateRangeEnd,
    options,
  );
}

export async function runOllamaFetchImport(
  aiConfig: AiConfig,
  options: { debugLog?: DebugLogger } = {},
): Promise<AiImportResult> {
  const today = getTodayIsoDate();
  const pageDumps = await buildPageDumps(aiConfig.sites ?? [], options);
  const prompt = buildFetchPrompt(
    today,
    aiConfig.interests,
    aiConfig.keywords ?? [],
    pageDumps,
    aiConfig.dateRangeStart,
    aiConfig.dateRangeEnd,
  );
  const text = await callOllama(aiConfig.ollamaUrl, aiConfig.ollamaModel, prompt);
  options.debugLog?.('[ai-import] Ollama raw response:', text.slice(0, 500));
  return filterEventsByDateRange(
    parseEventText(text, 'Ollama', options),
    aiConfig.dateRangeStart,
    aiConfig.dateRangeEnd,
    options,
  );
}

export async function runOpenAIFetchImport(
  aiConfig: AiConfig,
  options: { debugLog?: DebugLogger } = {},
): Promise<AiImportResult> {
  const today = getTodayIsoDate();
  const pageDumps = await buildPageDumps(aiConfig.sites ?? [], options);
  const prompt = buildFetchPrompt(
    today,
    aiConfig.interests,
    aiConfig.keywords ?? [],
    pageDumps,
    aiConfig.dateRangeStart,
    aiConfig.dateRangeEnd,
  );
  const text = await callOpenAI(aiConfig.apiKey, prompt);
  options.debugLog?.('[ai-import] OpenAI raw response:', text.slice(0, 500));
  return filterEventsByDateRange(
    parseEventText(text, 'OpenAI', options),
    aiConfig.dateRangeStart,
    aiConfig.dateRangeEnd,
    options,
  );
}

export async function listOllamaModels(ollamaUrl: string): Promise<string[]> {
  try {
    const resp = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/tags`);
    if (!resp.ok) return [];
    const json = (await resp.json()) as { models?: { name: string }[] };
    return (json.models || []).map(model => model.name);
  } catch {
    return [];
  }
}

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

  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'web-search-2025-03-05',
    'content-type': 'application/json',
  };
  return postJson<ClaudeResponse>('https://api.anthropic.com/v1/messages', body, headers, 60_000, true);
}

async function callOllama(baseUrl: string, model: string, prompt: string): Promise<string> {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Ollama URL must use http or https');
    }
  } catch (err) {
    throw new Error(`Invalid Ollama URL: ${err instanceof Error ? err.message : err}`);
  }

  const url = baseUrl.replace(/\/$/, '') + '/api/chat';
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  };
  const data = await postJson<OllamaResponse>(url, body, { 'content-type': 'application/json' }, 300_000, true);
  return data.message?.content ?? '';
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 8192,
  };
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const data = await postJson<OpenAIResponse>('https://api.openai.com/v1/chat/completions', body, headers, 120_000, true);
  return data.choices?.[0]?.message?.content ?? '';
}

async function postJson<T = unknown>(
  url: string,
  body: unknown,
  headers: Record<string, string> = { 'content-type': 'application/json' },
  timeoutMs = 120_000,
  parseJson = true,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${url} ${res.status}: ${text}`);
  }

  if (parseJson) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}
