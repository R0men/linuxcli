import toolsEn from './content/en/tools.json';
import siteEn from './content/en/site.json';

export const DEFAULT_LOCALE = 'en';

const CONTENT = {
  en: { tools: toolsEn, site: siteEn },
};

function localeContent(locale) {
  return CONTENT[locale] ?? CONTENT[DEFAULT_LOCALE];
}

export function getToolsList(locale) {
  return localeContent(locale).tools;
}

export function getToolContent(id, locale) {
  return localeContent(locale).tools.find((tool) => tool.id === id) ?? null;
}

export function getSiteContent(locale) {
  return localeContent(locale).site;
}
