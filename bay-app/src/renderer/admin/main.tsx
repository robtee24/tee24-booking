import React from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/types';
import App from './App';

document.body.classList.add('admin-body');
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
