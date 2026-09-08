import React from 'react';

export function SiteHeader() {
  return <header className="site-header">
    <div className="site-container site-header-inner">
      <a href="/" className="site-brand" aria-label="Overflow home">
        <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M3 10c4-5 7 5 11 0s7 5 11 0M3 17c4-5 7 5 11 0s7 5 11 0" /></svg>
        <span>overflow</span>
      </a>
    </div>
  </header>;
}
