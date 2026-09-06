import { Suspense } from 'react';
import AuthComplete from '@/components/AuthComplete/AuthComplete';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Signing in…',
  description: 'Completing sign-in.',
  path: '/auth/complete',
});

export default function AuthCompletePage() {
  return (
    <Suspense>
      <AuthComplete />
    </Suspense>
  );
}
