import AccountView from '@/components/AccountView/AccountView';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Account',
  description: 'Manage your LinuxCLI account.',
  path: '/account',
});

export default function AccountPage() {
  return <AccountView />;
}
