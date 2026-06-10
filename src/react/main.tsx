import { createRoot } from 'react-dom/client';
import { App } from './App';

// Entry for the React island. Mounts into #react-root in index.html, alongside
// the existing vanilla renderer. The Schedule view migrates in during Phase 2.
const container = document.getElementById('react-root');
if (container) {
  createRoot(container).render(<App />);
  container.dataset.mounted = 'true';
}
