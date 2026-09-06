import ToolsView from '@/components/ToolsView/ToolsView';
import { getSiteContent, getToolsList } from '@/lib/toolsContent';
import { getAllCommandParams } from '@/lib/commandsContent';
import { pageMetadata, SITE_URL } from '@/lib/seo';

export const metadata = pageMetadata({
  title: getSiteContent().tools.metaTitle,
  description: getSiteContent().tools.metaDescription,
  path: '/tools',
});

export default function ToolsPage() {
  const tools = getToolsList();

  // toolId -> /commands/<module>/<command> для тих тулів, де вже є
  // повна стаття (наразі не всі 8) — ToolSection показує лінк, тільки
  // якщо він реально існує.
  const articleUrls = Object.fromEntries(
    getAllCommandParams().map(({ module, command }) => [command, `/commands/${module}/${command}`])
  );

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: tools.map((tool, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: tool.label,
      url: `${SITE_URL}/tools#${tool.id}`,
    })),
  };

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ToolsView articleUrls={articleUrls} />
    </>
  );
}
