import Breadcrumb from '@/components/Breadcrumb/Breadcrumb';
import './CommandsHub.scss';

export default function CommandsHub({ modules }) {
  return (
    <div className="commands-hub">
      <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Commands' }]} />
      <h1>Command guides</h1>
      <p className="commands-hub-intro">
        In-depth guides for the diagnostic commands available in LinuxCLI&apos;s browser terminal, grouped by category.
      </p>
      <ul className="commands-hub-list">
        {modules.map((m) => (
          <li key={m.module}>
            <a href={`/commands/${m.module}`}>{m.label}</a>
            <span className="commands-hub-count">
              {m.count} guide{m.count === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
