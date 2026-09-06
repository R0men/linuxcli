import { notFound } from 'next/navigation';
import CommandModule from '@/components/CommandModule/CommandModule';
import { getModules, getCommandsInModule } from '@/lib/commandsContent';
import { pageMetadata, SITE_URL } from '@/lib/seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return getModules().map((module) => ({ module }));
}

export async function generateMetadata({ params }) {
  const { module } = await params;
  const commands = await getCommandsInModule(module);
  if (commands.length === 0) return {};
  const label = commands[0].moduleLabel;
  return pageMetadata({
    title: `${label} commands`,
    description: `Guides for the ${label} diagnostic commands available in LinuxCLI's browser terminal.`,
    path: `/commands/${module}`,
  });
}

export default async function ModulePage({ params }) {
  const { module } = await params;
  const commands = await getCommandsInModule(module);
  if (commands.length === 0) notFound();

  const label = commands[0].moduleLabel;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${label} commands`,
    url: `${SITE_URL}/commands/${module}`,
    hasPart: commands.map((c) => ({
      '@type': 'TechArticle',
      name: c.command,
      url: `${SITE_URL}/commands/${module}/${c.command}`,
    })),
  };

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <CommandModule module={module} moduleLabel={label} commands={commands} />
    </>
  );
}
