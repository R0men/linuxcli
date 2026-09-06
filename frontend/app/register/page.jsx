import RegisterView from '@/components/RegisterView/RegisterView';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Sign up',
  description: 'Create a LinuxCLI account for a persistent identity and higher rate limits.',
  path: '/register',
});

export default function RegisterPage() {
  return <RegisterView />;
}
