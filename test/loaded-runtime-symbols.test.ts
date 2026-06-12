import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Regression guard for the vanilla→React migration boundary. The renderer is built
// from plain <script> files sharing one global scope. tsconfig.renderer still *compiles*
// the retired vanilla views (schedule.ts, calendar-grid.ts) so the type-checker stays
// happy, but index.html no longer *loads* them — their symbols are absent at runtime.
//
// React edits time blocks through the live bridge (window.calderaSchedule →
// saveTimeBlock / updateTimeBlock / deleteTimeBlock in clock.ts). If one of those
// reaches back into a retired view it type-checks but throws "X is not defined" the
// moment a user saves a block. That is the exact bug this guards: saveTimeBlock used
// to call schedule.ts's setScheduleAmPm, which failed whenever a block's AM/PM differed
// from the clock's current meridian.

const root = process.cwd();
const readSrc = (file: string): string => readFileSync(resolve(root, 'src', file), 'utf8');

function topLevelFunctionNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^(?:const|let) ([A-Za-z0-9_]+)/gm)) names.add(match[1]);
  return names;
}

// Pull a top-level `function name(...) { ... }` body out of a global-script source file
// by reading to the first line that is a lone `}` (the function's column-0 close brace).
function extractTopLevelFunction(source: string, name: string): string {
  const lines = source.split('\n');
  const startIndex = lines.findIndex((line) => new RegExp(`^(?:async )?function ${name}\\b`).test(line));
  assert.notEqual(startIndex, -1, `expected clock.ts to define ${name}`);
  const endOffset = lines.slice(startIndex + 1).findIndex((line) => line === '}');
  assert.notEqual(endOffset, -1, `expected a column-0 close brace for ${name}`);
  return lines.slice(startIndex, startIndex + 1 + endOffset + 1).join('\n');
}

// Functions that index.html loads (share global scope with clock.ts at runtime).
const loadedScripts = ['renderer-ui.ts', 'renderer-data.ts', 'clock.ts', 'renderer.ts'];
// Compiled by tsconfig.renderer but intentionally not loaded (retired vanilla views).
const compiledButUnloaded = ['schedule.ts', 'calendar-grid.ts'];
// The live React→vanilla block-edit surface, exposed via window.calderaSchedule.
const bridgeFunctions = ['saveTimeBlock', 'updateTimeBlock', 'deleteTimeBlock'];

test('schedule bridge functions never call symbols defined only in unloaded vanilla scripts', () => {
  const loadedNames = topLevelFunctionNames(loadedScripts.map(readSrc).join('\n'));
  const retiredOnlyNames = compiledButUnloaded
    .flatMap((file) => [...topLevelFunctionNames(readSrc(file))])
    .filter((name) => !loadedNames.has(name));

  const clockSource = readSrc('clock.ts');
  const offenders: string[] = [];
  for (const fnName of bridgeFunctions) {
    const body = extractTopLevelFunction(clockSource, fnName);
    for (const retired of retiredOnlyNames) {
      if (new RegExp(`\\b${retired}\\s*\\(`).test(body)) {
        offenders.push(`${fnName} → ${retired}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Live schedule-bridge code calls retired symbols absent at runtime: ${offenders.join('; ')}`,
  );
});
