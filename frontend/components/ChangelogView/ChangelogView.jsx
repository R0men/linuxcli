import Breadcrumb from '@/components/Breadcrumb/Breadcrumb';
import { formatChangelogDate } from '@/lib/formatDate';
import './ChangelogView.scss';

export default function ChangelogView({ entries }) {
  return (
    <div className="changelog-view">
      <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: "What's new" }]} />
      <h1>What&apos;s new</h1>
      <p className="changelog-intro">New tools, guides and fixes shipped to LinuxCLI, newest first.</p>

      <div className="changelog-entries">
        {entries.map(({ slug, date, title, Content }) => (
          <article key={slug} id={slug} className="changelog-entry">
            <a className="changelog-entry-anchor" href={`#${slug}`}>
              <time dateTime={date}>{formatChangelogDate(date)}</time>
            </a>
            <h2>{title}</h2>
            <div className="changelog-entry-body">
              <Content />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
