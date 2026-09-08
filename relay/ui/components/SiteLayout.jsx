import React from 'react';
import { SiteHeader } from './SiteHeader.jsx';
import { SiteFooter } from './SiteFooter.jsx';
import siteStyles from '../site.css?raw';

export function SiteLayout({ title, description, path, styles = '', script, children }) {
  return <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta name="theme-color" content="#f5f5ef" />
      <meta name="description" content={description} />
      <title>{title}</title>
      <link rel="canonical" href={`https://overflow.kushalsm.com${path}`} />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet" />
      <style data-site-styles="" dangerouslySetInnerHTML={{ __html: siteStyles }} />
      <style dangerouslySetInnerHTML={{ __html: styles }} />
    </head>
    <body>
      <SiteHeader />
      <div className="site-container site-content">
        {children}
        <SiteFooter />
      </div>
      {script && <script dangerouslySetInnerHTML={{ __html: script }} />}
    </body>
  </html>;
}
