import HomeView from '@/components/HomeView/HomeView';
import { getSiteContent } from '@/lib/toolsContent';
import { getLatestChangelogEntries } from '@/lib/changelogContent';
import { pageMetadata, SITE_URL } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'LinuxCLI — a real Linux terminal in your browser',
  description: getSiteContent().home.metaDescription,
  path: '/',
});

export default async function HomePage() {
  const site = getSiteContent();
  const whatsNew = await getLatestChangelogEntries(3);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: site.brand,
    url: SITE_URL,
    description: site.home.metaDescription,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
  };

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomeView whatsNew={whatsNew} />
    </>
  );
}
