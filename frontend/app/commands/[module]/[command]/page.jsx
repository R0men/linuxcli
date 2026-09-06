import { notFound } from 'next/navigation';
import CommandArticle from '@/components/CommandArticle/CommandArticle';
import { getAllCommandParams } from '@/lib/commandsContent';
import { getToolContent } from '@/lib/toolsContent';
import { pageMetadata, SITE_URL } from '@/lib/seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllCommandParams();
}

async function loadArticle(module, command) {
  try {
    return await import(`@/content/commands/${module}/${command}.mdx`);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }) {
  const { module, command } = await params;
  const article = await loadArticle(module, command);
  if (!article) return {};
  return pageMetadata({
    title: article.metadata.title,
    description: article.metadata.description,
    path: `/commands/${module}/${command}`,
  });
}

export default async function CommandPage({ params }) {
  const { module, command } = await params;
  const article = await loadArticle(module, command);
  if (!article) notFound();

  const { default: Post, metadata, commandMeta } = article;
  const tool = getToolContent(commandMeta.toolId);
  const url = `${SITE_URL}/commands/${module}/${command}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: metadata.title,
    description: metadata.description,
    url,
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Commands', item: `${SITE_URL}/commands` },
      { '@type': 'ListItem', position: 3, name: commandMeta.moduleLabel, item: `${SITE_URL}/commands/${module}` },
      { '@type': 'ListItem', position: 4, name: commandMeta.label ?? commandMeta.command, item: url },
    ],
  };

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <CommandArticle
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Commands', href: '/commands' },
          { label: commandMeta.moduleLabel, href: `/commands/${module}` },
          { label: commandMeta.label ?? commandMeta.command },
        ]}
        toolId={commandMeta.toolId}
        commandLabel={tool?.label ?? commandMeta.label ?? commandMeta.command}
      >
        <Post />
      </CommandArticle>
    </>
  );
}
