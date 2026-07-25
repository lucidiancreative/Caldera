import { app, ipcMain, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { AiConfig, AiImportResult } from './types';
import {
  listOllamaModels,
  runFetchImport,
  runOllamaFetchImport,
  runOllamaWebSearchImport,
  runOpenAIFetchImport,
  runOpenAIWebSearchImport,
  runWebSearchImport,
} from './ai/model';

const debugLog = (...args: unknown[]) => {
  if (!app.isPackaged) console.log(...args);
};

interface StoredAiConfig extends AiConfig {
  _apiKeyEncrypted?: boolean;
  _ollamaApiKeyEncrypted?: boolean;
}

function isValidStoredAiConfig(stored: unknown): stored is StoredAiConfig {
  if (!stored || typeof stored !== 'object') return false;
  const value = stored as Record<string, unknown>;
  return (
    (value.provider === 'claude' || value.provider === 'ollama' || value.provider === 'openai') &&
    typeof value.interests === 'string' &&
    Array.isArray(value.sites)
  );
}

const calendarDataFilePath = (): string =>
  path.join(app.getPath('userData'), 'calendar-data.json');

function readCalendarDataFile(): Record<string, unknown> {
  const filePath = calendarDataFilePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeCalendarDataFile(data: Record<string, unknown>): void {
  fs.writeFileSync(calendarDataFilePath(), JSON.stringify(data, null, 2), 'utf8');
}

function encryptSecret(plaintext: string): { value: string; encrypted: boolean } {
  if (plaintext && safeStorage.isEncryptionAvailable()) {
    return { value: safeStorage.encryptString(plaintext).toString('base64'), encrypted: true };
  }
  return { value: plaintext, encrypted: false };
}

function decryptSecret(value: string | undefined, encrypted: boolean | undefined): string {
  if (encrypted && value && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    } catch {
      return '';
    }
  }
  return value ?? '';
}

function loadStoredAiConfig(): AiConfig | null {
  const data = readCalendarDataFile();
  const stored = data._aiConfig;
  if (!isValidStoredAiConfig(stored)) return null;
  return {
    ...stored,
    apiKey: decryptSecret(stored.apiKey, stored._apiKeyEncrypted),
    ollamaApiKey: decryptSecret(stored.ollamaApiKey, stored._ollamaApiKeyEncrypted),
    _apiKeyEncrypted: undefined,
    _ollamaApiKeyEncrypted: undefined,
  } as AiConfig;
}

ipcMain.handle('ai-save-config', async (_event, config: AiConfig) => {
  const data = readCalendarDataFile();
  const apiKey = encryptSecret(config.apiKey);
  const ollamaApiKey = encryptSecret(config.ollamaApiKey ?? '');
  data._aiConfig = {
    ...config,
    apiKey: apiKey.value,
    _apiKeyEncrypted: apiKey.encrypted,
    ollamaApiKey: ollamaApiKey.value,
    _ollamaApiKeyEncrypted: ollamaApiKey.encrypted,
  } satisfies StoredAiConfig;
  writeCalendarDataFile(data);
});

ipcMain.handle('ai-load-config', async (): Promise<AiConfig | null> => {
  return loadStoredAiConfig();
});

ipcMain.handle('ai-run-import', async (): Promise<AiImportResult> => {
  const aiConfig = loadStoredAiConfig();
  if (!aiConfig) return { error: 'No AI config found. Save settings first.' };

  const webSearch = aiConfig.mode === 'websearch';

  if (aiConfig.provider === 'ollama') {
    if (!aiConfig.ollamaUrl) return { error: 'No Ollama endpoint configured.' };
    if (webSearch && !aiConfig.ollamaApiKey) {
      return { error: 'An Ollama API key is required for web search. Create one in your ollama.com account settings.' };
    }
  } else if (!aiConfig.apiKey) {
    return { error: 'No API key configured.' };
  }

  try {
    if (webSearch) {
      if (aiConfig.provider === 'ollama') return await runOllamaWebSearchImport(aiConfig, { debugLog });
      if (aiConfig.provider === 'openai') return await runOpenAIWebSearchImport(aiConfig, { debugLog });
      return await runWebSearchImport(aiConfig, { debugLog });
    }
    if (aiConfig.provider === 'ollama') return await runOllamaFetchImport(aiConfig, { debugLog });
    if (aiConfig.provider === 'openai') return await runOpenAIFetchImport(aiConfig, { debugLog });
    return await runFetchImport(aiConfig, { debugLog });
  } catch (err) {
    console.error('[ai-run-import]', err);
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('ollama-list-models', async (): Promise<string[]> => {
  let ollamaUrl = 'http://localhost:11434';
  const stored = loadStoredAiConfig();
  if (stored?.ollamaUrl) ollamaUrl = stored.ollamaUrl;

  try {
    return await listOllamaModels(ollamaUrl);
  } catch {
    return [];
  }
});
