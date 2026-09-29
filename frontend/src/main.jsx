import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import './styles/theme.scss';
import App from './App';
import { ROUTER_BASENAME } from './core/workspaceUrl';
import { AuthProvider } from './core/context/AuthContext';
import { WorkspaceProvider } from './core/context/WorkspaceContext';
import { ToastProvider } from './core/context/ToastContext';

// FontAwesome CSS is bundled above, so it doesn't need to inject a <style> tag at runtime.
config.autoAddCss = false;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={ROUTER_BASENAME}>
      <ToastProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <App />
          </WorkspaceProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
