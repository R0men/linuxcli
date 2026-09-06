import './globals.scss';
import './layout.scss';
import SiteHeader from '@/components/SiteHeader/SiteHeader';
import CookieNotice from '@/components/CookieNotice/CookieNotice';
import { getSiteContent } from '@/lib/toolsContent';
import { SITE_URL } from '@/lib/seo';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'LinuxCLI — a real Linux terminal in your browser',
    template: '%s | LinuxCLI',
  },
  description:
    'Run dig, whois, curl, ping and other network diagnostic tools online in a disposable, sandboxed Linux terminal — no install, no signup.',
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
  openGraph: {
    title: 'LinuxCLI — a real Linux terminal in your browser',
    description:
      'Run dig, whois, curl, ping and other network diagnostic tools online in a disposable, sandboxed Linux terminal — no install, no signup.',
    siteName: 'LinuxCLI',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LinuxCLI — a real Linux terminal in your browser',
    description:
      'Run dig, whois, curl, ping and other network diagnostic tools online in a disposable, sandboxed Linux terminal — no install, no signup.',
  },
};

// Виставляє data-theme до першого фарбування, щоб не було світлого
// спалаху перед тим, як застосується збережена/системна темна тема.
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('theme');var t=s||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }) {
  const site = getSiteContent();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <SiteHeader site={site} />
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          <p>{site.footer}</p>
          <p className="site-footer-legal">
            <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
          </p>
        </footer>
        <CookieNotice />
      </body>
    </html>
  );
}
