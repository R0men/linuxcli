import fs from 'fs';
import path from 'path';

// Джерело правди — сама файлова структура content/commands/<module>/<command>.mdx,
// не окремий реєстр. Новий пост = новий .mdx файл, нічого більше міняти не треба.
const CONTENT_DIR = path.join(process.cwd(), 'content', 'commands');

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function getModules() {
  return safeReadDir(CONTENT_DIR)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function getCommandIdsInModule(module) {
  return safeReadDir(path.join(CONTENT_DIR, module))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
    .map((entry) => entry.name.replace(/\.mdx$/, ''))
    .sort();
}

export function getAllCommandParams() {
  return getModules().flatMap((module) => getCommandIdsInModule(module).map((command) => ({ module, command })));
}

export async function getCommandsInModule(module) {
  const ids = getCommandIdsInModule(module);
  const commands = await Promise.all(
    ids.map(async (command) => {
      const mod = await import(`@/content/commands/${module}/${command}.mdx`);
      return mod.commandMeta;
    })
  );
  return commands;
}

export async function getAllCommands() {
  const perModule = await Promise.all(getModules().map((module) => getCommandsInModule(module)));
  return perModule.flat();
}

export async function getModuleSummaries() {
  return Promise.all(
    getModules().map(async (module) => {
      const commands = await getCommandsInModule(module);
      return { module, label: commands[0]?.moduleLabel ?? module, count: commands.length };
    })
  );
}

export function commandUrl({ module, command }) {
  return `/commands/${module}/${command}`;
}
