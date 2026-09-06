import './AboutView.scss';

export default function AboutView({ about }) {
  return (
    <div>
      <h1>{about.title}</h1>
      {about.body.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}

      <section aria-labelledby="sandbox-heading">
        <h2 id="sandbox-heading">{about.sandbox.title}</h2>
        {about.sandbox.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>

      <section aria-labelledby="privacy-blurb-heading">
        <h2 id="privacy-blurb-heading">{about.privacyBlurb.title}</h2>
        {about.privacyBlurb.body.map((paragraph, index) => (
          <p key={paragraph}>
            {paragraph}
            {index === about.privacyBlurb.body.length - 1 && (
              <>
                <a href={about.privacyBlurb.linkHref}>{about.privacyBlurb.linkText}</a>
                {about.privacyBlurb.afterLink}
              </>
            )}
          </p>
        ))}
      </section>

      <section id="acceptable-use" className="acceptable-use" aria-labelledby="acceptable-use-heading">
        <h2 id="acceptable-use-heading">{about.acceptableUse.title}</h2>
        {about.acceptableUse.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p>
          {about.acceptableUse.beforeLink}
          <a href={about.acceptableUse.linkHref}>{about.acceptableUse.linkText}</a>.
        </p>
      </section>

      <p className="built-by">
        {about.builtBy.beforeLink}
        <a href={about.builtBy.linkHref} target="_blank" rel="noreferrer">
          {about.builtBy.linkText}
        </a>
        {about.builtBy.afterLink}
      </p>
    </div>
  );
}
