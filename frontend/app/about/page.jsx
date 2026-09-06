import AboutView from '@/components/AboutView/AboutView';
import { getSiteContent } from '@/lib/toolsContent';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'About',
  description: getSiteContent().about.metaDescription,
  path: '/about',
});

export default function AboutPage() {
  const { about } = getSiteContent();
  return <AboutView about={about} />;
}
