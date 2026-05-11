import React from 'react';
import { createRoot } from 'react-dom/client';
import AccountSegmentationModel from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AccountSegmentationModel />
  </React.StrictMode>,
);
