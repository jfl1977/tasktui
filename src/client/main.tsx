import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CaptureApp } from './components/CaptureApp';
import { StoreProvider } from './store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      {location.pathname.startsWith('/capture') ? <CaptureApp /> : <App />}
    </StoreProvider>
  </StrictMode>,
);
