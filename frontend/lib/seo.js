const SITE_NAME = 'LinuxCLI';

// Єдина точка правди для домену — раніше дублювалось в 8 файлах
// (app/layout.jsx, app/sitemap.js, app/robots.js, app/page.jsx,
// app/tools/page.jsx, app/commands/**), зміна домену вимагала правки
// в кожному окремо.
export const SITE_URL = 'https://linuxcli.xyz';

// Next не підтягує og:title/og:description з plain title/description
// автоматично (docs: openGraph — окреме поле, мерджиться незалежно) —
// тому кожна сторінка явно дублює їх сюди через цей хелпер.
export function pageMetadata({ title, description, path }) {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      type: 'website',
      images: ['/opengraph-image'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/opengraph-image'],
    },
  };
}
