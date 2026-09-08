import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardPage } from './pages/BoardPage.jsx';
import { LegalPage } from './pages/LegalPage.jsx';
import { privacy, terms } from './pages/legal-content.js';

export function renderPages(boardScript) {
  const html = page => '<!doctype html>' + renderToStaticMarkup(page);
  return {
    '/': html(<BoardPage script={boardScript} />),
    '/privacy': html(<LegalPage title="Privacy Policy" path="/privacy" content={privacy} />),
    '/terms': html(<LegalPage title="Terms of Service" path="/terms" content={terms} />),
  };
}
