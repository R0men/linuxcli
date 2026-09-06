import fs from 'fs';
import path from 'path';

// Той самий патерн, що й commandsContent.js: файлова структура
// content/changelog/*.mdx — джерело правди, новий запис = новий файл.
const CONTENT_DIR = path.join(process.cwd(), 'content', 'changelog');

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function getEntrySlugs() {
  return safeReadDir(CONTENT_DIR)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
    .map((entry) => entry.name.replace(/\.mdx$/, ''));
}

export async function getAllChangelogEntries() {
  const slugs = getEntrySlugs();
  const entries = await Promise.all(
    slugs.map(async (slug) => {
      const mod = await import(`@/content/changelog/${slug}.mdx`);
      return { slug, Content: mod.default, ...mod.changelogMeta };
    })
  );
  return entries.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getLatestChangelogEntries(count) {
  const entries = await getAllChangelogEntries();
  return entries.slice(0, count).map(({ slug, date, title, summary }) => ({ slug, date, title, summary }));
}
