import ThemeToggle from '@/components/ThemeToggle/ThemeToggle';
import AuthStatus from '@/components/AuthStatus/AuthStatus';
import './SiteHeader.scss';

export default function SiteHeader({ site }) {
  return (
    <header className="site-header">
      <a className="brand" href="/">
        {site.brand}
      </a>
      <nav className="site-nav">
        <a href="/tools">{site.nav.tools}</a>
        <a href="/commands">{site.nav.commands}</a>
        <a href="/changelog">{site.nav.changelog}</a>
        <a href="/about">{site.nav.about}</a>
      </nav>
      <div className="site-header-actions">
        <AuthStatus />
        <ThemeToggle />
      </div>
    </header>
  );
}
