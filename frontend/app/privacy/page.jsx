import PrivacyView from '@/components/PrivacyView/PrivacyView';
import { getSiteContent } from '@/lib/toolsContent';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Privacy Policy',
  description: getSiteContent().privacy.metaDescription,
  path: '/privacy',
});

export default function PrivacyPage() {
  const { privacy } = getSiteContent();
  return <PrivacyView privacy={privacy} />;
}
