import ChangelogView from '@/components/ChangelogView/ChangelogView';
import { getAllChangelogEntries } from '@/lib/changelogContent';
import { pageMetadata, SITE_URL } from '@/lib/seo';

export const metadata = pageMetadata({
  title: "What's new — LinuxCLI changelog",
  description: 'New tools, guides and fixes shipped to LinuxCLI, newest first.',
  path: '/changelog',
});

export default async function ChangelogPage() {
  const entries = await getAllChangelogEntries();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: "What's new — LinuxCLI",
    url: `${SITE_URL}/changelog`,
    blogPost: entries.map((e) => ({
      '@type': 'BlogPosting',
      headline: e.title,
      description: e.summary,
      datePublished: e.date,
      url: `${SITE_URL}/changelog#${e.slug}`,
    })),
  };

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ChangelogView entries={entries} />
    </>
  );
}
