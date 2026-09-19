import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// `M213` `S0` (`D1098`) — the five vendored families, before the stylesheet that names them.
import './fonts.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('tflw ui: no #root element to mount into');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
