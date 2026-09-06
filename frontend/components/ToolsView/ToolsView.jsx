'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import ToolSection from '@/components/ToolSection/ToolSection';
import TerminalSkeleton from '@/components/TerminalSkeleton/TerminalSkeleton';
import { getSiteContent, getToolsList } from '@/lib/toolsContent';
import './ToolsView.scss';

const Terminal = dynamic(() => import('@/components/Terminal/Terminal'), {
  ssr: false,
  loading: () => <TerminalSkeleton />,
});

export default function ToolsView({ articleUrls = {} }) {
  const site = getSiteContent();
  const tools = getToolsList();
  const [prefill, setPrefill] = useState(null);

  // Один спільний Terminal-інстанс на всю сторінку (§ рішення про
  // єдиний /tools URL) — кнопка тула лише прописує prefill і скролить
  // до нього, WS-з'єднання й xterm не перестворюються.
  const handleRun = useCallback((tool) => {
    setPrefill({ command: tool.exampleCommand, nonce: Date.now() });
    document.getElementById('terminal-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="tools-page">
      <h1>{site.tools.h1}</h1>
      <p className="tools-intro">{site.tools.intro}</p>

      <div id="terminal-anchor" className="terminal-wrap">
        <Terminal prefill={prefill} />
      </div>

      <nav className="tools-jumplinks" aria-label="Jump to a tool">
        {tools.map((tool) => (
          <a key={tool.id} href={`#${tool.id}`}>
            {tool.label}
          </a>
        ))}
      </nav>

      {tools.map((tool) => (
        <ToolSection key={tool.id} tool={tool} onRun={handleRun} articleUrl={articleUrls[tool.id]} />
      ))}
    </div>
  );
}
