const { spawn } = require('node:child_process');
const path = require('node:path');

const electronBinaryPath = require('electron');
const projectRootPath = path.resolve(__dirname, '..');
const childEnv = { ...process.env };

delete childEnv.ELECTRON_RUN_AS_NODE;

const electronProcess = spawn(electronBinaryPath, ['.'], {
  cwd: projectRootPath,
  env: childEnv,
  stdio: 'inherit',
});

electronProcess.on('error', (error) => {
  console.error('Failed to launch Electron:', error);
  process.exit(1);
});

electronProcess.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Electron exited from signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
