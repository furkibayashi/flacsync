import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MiniPlayer } from './pages/MiniPlayer';
import { I18nProvider } from './i18n/I18nProvider';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root bulunamadı');

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      {/* Masaüstü mini oynatıcı penceresi ayrı, sade bir ekrandır (indirme sırası / ses motoru yok) */}
      {window.location.hash.startsWith('#/mini') ? <MiniPlayer /> : <App />}
    </I18nProvider>
  </StrictMode>,
);
