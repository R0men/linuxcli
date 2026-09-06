import CommandsHub from '@/components/CommandsHub/CommandsHub';
import { getModuleSummaries } from '@/lib/commandsContent';
import { pageMetadata, SITE_URL } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Command guides',
  description: "In-depth guides for the diagnostic commands available in LinuxCLI's browser terminal, grouped by category.",
  path: '/commands',
});

export default async function CommandsPage() {
  const modules = await getModuleSummaries();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Command guides',
    url: `${SITE_URL}/commands`,
    hasPart: modules.map((m) => ({
      '@type': 'CollectionPage',
      name: `${m.label} commands`,
      url: `${SITE_URL}/commands/${m.module}`,
    })),
  };

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <CommandsHub modules={modules} />
    </>
  );
}
