import Breadcrumb from '@/components/Breadcrumb/Breadcrumb';
import './CommandModule.scss';

export default function CommandModule({ module, moduleLabel, commands }) {
  return (
    <div className="command-module">
      <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Commands', href: '/commands' }, { label: moduleLabel }]} />
      <h1>{moduleLabel} commands</h1>
      <ul className="command-module-list">
        {commands.map((c) => (
          <li key={c.command}>
            <a href={`/commands/${module}/${c.command}`}>{c.label ?? c.command}</a>
            <p>{c.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
