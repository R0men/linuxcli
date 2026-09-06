import Breadcrumb from '@/components/Breadcrumb/Breadcrumb';
import './CommandArticle.scss';

export default function CommandArticle({ breadcrumb, toolId, commandLabel, children }) {
  return (
    <article className="command-article">
      <Breadcrumb items={breadcrumb} />

      <div className="command-article-body">{children}</div>

      {/* Сценарні статті (module: troubleshooting) охоплюють кілька тулів
          одразу — немає одного "цього" тула для CTA, посилання на кожен
          тул уже є inline в самому тексті гайду. */}
      {toolId && (
        <a className="command-article-cta" href={`/tools#${toolId}`}>
          {`Run \`${commandLabel}\` in the terminal →`}
        </a>
      )}
    </article>
  );
}
