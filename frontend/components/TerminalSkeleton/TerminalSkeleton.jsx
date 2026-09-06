import './TerminalSkeleton.scss';

export default function TerminalSkeleton() {
  return (
    <div className="terminal-skeleton" aria-hidden="true">
      <div className="terminal-skeleton-statusbar">
        <span className="terminal-skeleton-pill terminal-skeleton-pill--status" />
        <span className="terminal-skeleton-pill terminal-skeleton-pill--btn" />
        <span className="terminal-skeleton-pill terminal-skeleton-pill--btn" />
      </div>
      <div className="terminal-skeleton-body" />
    </div>
  );
}
