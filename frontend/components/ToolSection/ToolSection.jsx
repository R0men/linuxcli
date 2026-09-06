import './ToolSection.scss';

export default function ToolSection({ tool, onRun, articleUrl }) {
  return (
    <section id={tool.id} className="tool-section" aria-labelledby={`${tool.id}-heading`}>
      <h2 id={`${tool.id}-heading`}>{tool.h2}</h2>
      <p>{tool.intro}</p>
      <pre className="tool-example">
        <code>{tool.exampleCommand}</code>
      </pre>
      <p>{tool.description}</p>
      {tool.useCases?.length > 0 && (
        <ul className="tool-usecases">
          {tool.useCases.map((useCase) => (
            <li key={useCase}>{useCase}</li>
          ))}
        </ul>
      )}
      <div className="tool-section-actions">
        <button type="button" className="tool-run-btn" onClick={() => onRun(tool)}>
          {`Run \`${tool.binary}\` →`}
        </button>
        {articleUrl && (
          <a className="tool-guide-link" href={articleUrl}>
            Read the full guide →
          </a>
        )}
      </div>
    </section>
  );
}
