import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The renderer loads over file:// under a strict CSP, where ES module scripts do
// not load. So the React island is built as a single self-executing IIFE bundle
// (React included) that loads via a classic <script src> tag, side by side with
// the existing vanilla renderer scripts. No dev server is needed for the hybrid
// migration phase; `vite build --watch` rebuilds the bundle on change.
export default defineConfig({
  plugins: [react()],
  // Library mode doesn't inject this, so React/ReactDOM reference an undefined
  // `process` in the sandboxed renderer. Pin it to production: removes the crash,
  // selects React's prod code path, and shrinks the bundle.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist/react',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/react/main.tsx'),
      formats: ['iife'],
      name: 'CalderaReact',
      fileName: () => 'app.js',
    },
  },
});
