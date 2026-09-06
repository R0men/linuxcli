import { Suspense } from 'react';
import LoginView from '@/components/LoginView/LoginView';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Log in',
  description: 'Log in to your LinuxCLI account.',
  path: '/login',
});

export default function LoginPage() {
  // useSearchParams() всередині LoginView (читає ?error=oauth_failed)
  // вимагає Suspense-межу при static export — інакше next build падає.
  return (
    <Suspense>
      <LoginView />
    </Suspense>
  );
}
