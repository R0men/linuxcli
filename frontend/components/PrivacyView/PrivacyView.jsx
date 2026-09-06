import './PrivacyView.scss';

export default function PrivacyView({ privacy }) {
  return (
    <div className="legal-view">
      <h1>{privacy.title}</h1>

      {privacy.intro.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}

      {privacy.sections.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`}>
          <h2 id={`${section.id}-heading`}>{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}

      <section id={privacy.retentionTable.id} aria-labelledby="retention-heading">
        <h2 id="retention-heading">{privacy.retentionTable.heading}</h2>
        <table className="legal-retention-table">
          <tbody>
            {privacy.retentionTable.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="your-rights-heading">
        <h2 id="your-rights-heading">{privacy.yourRights.heading}</h2>
        <p>
          {privacy.yourRights.body[0]}
          <a href={privacy.yourRights.linkHref}>{privacy.yourRights.linkText}</a>
          {privacy.yourRights.afterLink}
        </p>
        <p className="legal-caveat">{privacy.yourRights.caveat}</p>
      </section>
    </div>
  );
}
