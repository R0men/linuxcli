import { getToolsList, getSiteContent } from '@/lib/toolsContent';
import { getAllCommands } from '@/lib/commandsContent';
import { SITE_URL } from '@/lib/seo';

export const dynamic = 'force-static';

export async function GET() {
  const site = getSiteContent();
  const tools = getToolsList();
  const commands = await getAllCommands();

  const lines = [
    `# ${site.brand}`,
    '',
    `> ${site.tagline}`,
    '',
    'LinuxCLI runs a fixed whitelist of read-only network diagnostic and OSINT ' +
      'command-line tools (dig, whois, host, curl, openssl s_client, mtr, ping, nc) ' +
      'inside a disposable, sandboxed Docker container reachable straight from the ' +
      'browser: one real command per session, live output, no install, no signup, ' +
      'no persistent state.',
    '',
    '## Tools',
    '',
    ...tools.map((tool) => `- [${tool.h2}](${SITE_URL}/tools#${tool.id}): ${tool.intro}`),
    '',
    '## Guides',
    '',
    ...commands.map(
      (cmd) => `- [${cmd.moduleLabel} / ${cmd.command}](${SITE_URL}/commands/${cmd.module}/${cmd.command}): ${cmd.summary}`
    ),
    '',
    '## Optional',
    '',
    `- [About](${SITE_URL}/about): what LinuxCLI is, how the sandbox works, acceptable use policy`,
    `- [All guides](${SITE_URL}/commands): index of every guide listed above`,
    `- [Privacy Policy](${SITE_URL}/privacy)`,
    `- [Terms of Service](${SITE_URL}/terms)`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
