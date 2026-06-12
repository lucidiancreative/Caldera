import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Regression guard for the renderer's two separate manifests. The plain renderer scripts
// share one global scope, but the set that gets *compiled* (tsconfig.renderer.json `include`)
// and the set that gets *loaded* (the dist scripts in index.html) are maintained by hand in
// two different files. When they drift — a file compiled but not loaded, or vice versa — code
// type-checks against a symbol that is absent at runtime and throws "X is not defined" only
// when that path runs (the v1.7.15 saveTimeBlock → setScheduleAmPm bug). Keeping the two
// manifests aligned structurally prevents that whole class.

const root = process.cwd();

function compiledScriptNames(): string[] {
  const cfg = JSON.parse(readFileSync(resolve(root, 'tsconfig.renderer.json'), 'utf8')) as { include: string[] };
  return cfg.include
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .map((file) => file.replace(/^src\//, '').replace(/\.ts$/, ''))
    .sort();
}

function loadedScriptNames(): string[] {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const names: string[] = [];
  // The React bundle (dist/react/app.js) is a module with its own scope, built by vite — it
  // reaches the vanilla world only through window bridges, so it is not part of this manifest.
  for (const match of html.matchAll(/<script\s+src="dist\/([^"]+)\.js"><\/script>/g)) {
    if (match[1].startsWith('react/')) continue;
    names.push(match[1]);
  }
  return names.sort();
}

test('renderer compile list (tsconfig.renderer) and load list (index.html) stay aligned', () => {
  assert.deepEqual(
    loadedScriptNames(),
    compiledScriptNames(),
    'Every plain renderer script must be both compiled by tsconfig.renderer.json and loaded by index.html. ' +
      'A mismatch means a script is compiled-but-not-loaded (or loaded-but-not-compiled), which lets a runtime ' +
      'symbol-not-defined bug slip past the type-checker.',
  );
});
