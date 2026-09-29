import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import './styles/theme.scss';
import App from './App';
import { AuthProvider } from './core/context/AuthContext';
import { AppsProvider } from './core/context/AppsContext';
import { ToastProvider } from './core/context/ToastContext';

// FontAwesome CSS is bundled above, so it doesn't need to inject a <style> tag at runtime.
config.autoAddCss = false;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ToastProvider>
        <AuthProvider>
          <AppsProvider>
            <App />
          </AppsProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
