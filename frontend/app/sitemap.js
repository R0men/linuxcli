import { getAllCommandParams, getModules } from '@/lib/commandsContent';
import { SITE_URL } from '@/lib/seo';

export const dynamic = 'force-static';

export default function sitemap() {
  const routes = [
    { path: '', priority: 1 },
    { path: '/tools', priority: 0.9 },
    { path: '/about', priority: 0.5 },
    { path: '/privacy', priority: 0.3 },
    { path: '/terms', priority: 0.3 },
    { path: '/commands', priority: 0.7 },
    ...getModules().map((module) => ({ path: `/commands/${module}`, priority: 0.6 })),
    ...getAllCommandParams().map(({ module, command }) => ({ path: `/commands/${module}/${command}`, priority: 0.8 })),
    // Одна сторінка з усіма записами (не окрема на кожен, як /commands) —
    // оновлюється частіше за решту статичного контенту.
    { path: '/changelog', priority: 0.6, changeFrequency: 'weekly' },
  ];

  return routes.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified: new Date(),
    changeFrequency: route.changeFrequency ?? 'monthly',
    priority: route.priority,
  }));
}
