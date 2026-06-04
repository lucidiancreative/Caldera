import { BrowserWindow } from 'electron';

type DebugLogger = (...args: unknown[]) => void;

export async function renderPage(
  rawUrl: string,
  options: { debugLog?: DebugLogger } = {},
): Promise<string> {
  const debugLog = options.debugLog;
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  } catch {
    return '';
  }

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: 'ai-scrape',
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
        const trimmedText = text.replace(/\s+/g, ' ').trim().slice(0, 45_000);
        const linkSection = linksJson !== '[]'
          ? `\nLINKS ON PAGE (JSON array - use these to find sourceUrl for each event):\n${linksJson.slice(0, 8_000)}`
          : '';
        const trimmed = (trimmedText + linkSection).slice(0, 50_000);
        debugLog?.(`[ai-import] rendered ${url} (${reason}) - ${trimmedText.length} chars text, ${linksJson.length} chars links`);
        resolve(trimmed);
      } catch {
        resolve('');
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
    };

    const hardTimer = setTimeout(() => finish('timeout'), 20_000);

    win.webContents.on('did-finish-load', () => {
      clearTimeout(hardTimer);
      setTimeout(() => finish('did-finish-load'), 2_500);
    });

    win.webContents.on('did-fail-load', (_event, code) => {
      if (code === -3) return;
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

export async function buildPageDumps(
  sites: string[],
  options: { debugLog?: DebugLogger } = {},
): Promise<string[]> {
  const results: string[] = new Array(sites.length);
  const maxConcurrentScrapers = 3;
  let nextIndex = 0;

  async function scraperWorker(): Promise<void> {
    while (nextIndex < sites.length) {
      const index = nextIndex++;
      const rawUrl = sites[index];
      const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      const text = await renderPage(rawUrl, options);
      results[index] = text ? `--- SOURCE: ${url} ---\n${text}` : `--- SOURCE: ${url} --- [FAILED TO LOAD]`;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrentScrapers, sites.length) }, scraperWorker),
  );
  return results;
}
