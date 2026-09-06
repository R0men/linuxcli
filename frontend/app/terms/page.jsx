import TermsView from '@/components/TermsView/TermsView';
import { getSiteContent } from '@/lib/toolsContent';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Terms of Service',
  description: getSiteContent().terms.metaDescription,
  path: '/terms',
});

export default function TermsPage() {
  const { terms } = getSiteContent();
  return <TermsView terms={terms} />;
}
