import './TermsView.scss';

export default function TermsView({ terms }) {
  return (
    <div className="legal-view">
      <h1>{terms.title}</h1>

      {terms.intro.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}

      {terms.sections.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`}>
          <h2 id={`${section.id}-heading`}>{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
    </div>
  );
}
