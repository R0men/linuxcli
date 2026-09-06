'use client';

import dynamic from 'next/dynamic';
import TerminalSkeleton from '@/components/TerminalSkeleton/TerminalSkeleton';
import { getSiteContent, getToolsList } from '@/lib/toolsContent';
import { formatChangelogDate } from '@/lib/formatDate';
import './HomeView.scss';

const Terminal = dynamic(() => import('@/components/Terminal/Terminal'), {
  ssr: false,
  loading: () => <TerminalSkeleton />,
});

export default function HomeView({ whatsNew = [] }) {
  const site = getSiteContent();
  const tools = getToolsList();

  return (
    <div>
      <section className="hero">
        <h1>{site.home.heroTitle}</h1>
        <p>{site.home.heroSubtitle}</p>
      </section>

      <div className="terminal-wrap">
        <Terminal />
      </div>

      <section className="home-tools-list">
        <h2>Available tools</h2>
        <ul>
          {tools.map((tool) => (
            <li key={tool.id}>
              <a href={`/tools#${tool.id}`}>{tool.label}</a>
            </li>
          ))}
        </ul>
        <a className="tools-cta" href="/tools">
          {site.home.ctaToolsLabel}
        </a>
      </section>

      {whatsNew.length > 0 && (
        <section className="home-whats-new">
          <h2>What&apos;s new</h2>
          <ul>
            {whatsNew.map((entry) => (
              <li key={entry.slug}>
                <a href={`/changelog#${entry.slug}`}>
                  <time dateTime={entry.date}>{formatChangelogDate(entry.date)}</time>
                  <span className="whats-new-title">{entry.title}</span>
                </a>
              </li>
            ))}
          </ul>
          <a className="whats-new-cta" href="/changelog">
            Full changelog →
          </a>
        </section>
      )}

      <section className="home-seo-article">
        <h2>{site.home.seoArticle.title}</h2>
        {site.home.seoArticle.sections.map((s) => (
          <div key={s.heading}>
            <h3>{s.heading}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
