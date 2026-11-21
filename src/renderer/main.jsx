import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles.css';
// The last theme is applied before the first paint (the settings arrive a moment later).
try { document.documentElement.dataset.theme = localStorage.getItem('dtm-theme') === 'light' ? 'light' : 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }
// Every native confirm()/alert() gives the keyboard back to the page afterwards (Electron could
// leave inputs deaf to typing after one, 2026-11-13).
for (const name of ['confirm', 'alert']) {
  const native = window[name].bind(window);
  window[name] = (...args) => { const r = native(...args); try { window.dreamteam?.app?.refocus?.(); } catch {} return r; };
}
createRoot(document.getElementById('root')).render(<App/>);
