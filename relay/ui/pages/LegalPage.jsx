import React from 'react';
import { SiteLayout } from '../components/SiteLayout.jsx';
import { updated } from './legal-content.js';
import styles from './legal.css?raw';

export function LegalPage({ title, path, content }) {
  return <SiteLayout title={`${title} · Overflow`} description={`${title} for Overflow, the shared task exchange.`} path={path} styles={styles}>
    <main className="legal-page">
      <h1>{title}</h1>
      <p className="legal-date">Last updated {updated}</p>
      <div dangerouslySetInnerHTML={{ __html: content }} />
    </main>
  </SiteLayout>;
}
