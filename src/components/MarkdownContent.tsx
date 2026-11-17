import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { parseInlineMarkdown, parseMarkdownBlocks } from '../lib/markdown';

function InlineRenderer({ text }: { text: string }) {
  const segments = parseInlineMarkdown(text);
  return (
    <>
      {segments.map((seg, idx) => {
        if (seg.type === 'bold') {
          return (
            <strong key={idx} className="font-semibold text-slate-900 dark:text-slate-100">
              {seg.text}
            </strong>
          );
        }
        if (seg.type === 'italic') {
          return (
            <em key={idx} className="italic">
              {seg.text}
            </em>
          );
        }
        if (seg.type === 'code') {
          return (
            <code
              key={idx}
              className="font-mono text-[13px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
            >
              {seg.text}
            </code>
          );
        }
        if (seg.type === 'link') {
          return (
            <a
              key={idx}
              href={seg.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline decoration-blue-600/40 underline-offset-2 hover:decoration-blue-600 dark:text-blue-400 dark:decoration-blue-400/40"
            >
              {seg.label}
            </a>
          );
        }
        return <span key={idx}>{seg.text}</span>;
      })}
    </>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 text-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 text-xs text-slate-400">
        <span className="font-mono">{lang || 'metin'}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Kodu kopyala"
          className="inline-flex items-center gap-1 text-slate-300 hover:text-white transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-[13px] leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownContent({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="space-y-3 text-[15px] leading-[1.65] text-slate-800 dark:text-slate-200">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          if (block.level === 1) {
            return (
              <h2
                key={index}
                className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100 pt-2"
              >
                <InlineRenderer text={block.text} />
              </h2>
            );
          }
          if (block.level === 2) {
            return (
              <h3
                key={index}
                className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100 pt-1.5"
              >
                <InlineRenderer text={block.text} />
              </h3>
            );
          }
          return (
            <h4
              key={index}
              className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 pt-1"
            >
              <InlineRenderer text={block.text} />
            </h4>
          );
        }

        if (block.type === 'paragraph') {
          return (
            <p key={index}>
              <InlineRenderer text={block.text} />
            </p>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={index} className="list-disc pl-5 space-y-1.5">
              {block.items.map((item, idx) => (
                <li key={idx}>
                  <InlineRenderer text={item} />
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={index} className="list-decimal pl-5 space-y-1.5 tabular-nums">
              {block.items.map((item, idx) => (
                <li key={idx}>
                  <InlineRenderer text={item} />
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === 'code') {
          return <CodeBlock key={index} lang={block.lang} code={block.code} />;
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote
              key={index}
              className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300"
            >
              <InlineRenderer text={block.text} />
            </blockquote>
          );
        }

        if (block.type === 'table') {
          return (
            <div
              key={index}
              className="my-3 overflow-x-auto rounded-xl border border-white/[0.1] bg-[#0c1018]"
            >
              <table className="w-full text-left text-xs sm:text-[13px] border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.1] bg-white/[0.04]">
                    {block.headers.map((header, idx) => (
                      <th
                        key={idx}
                        className="px-3.5 py-2.5 font-semibold text-white whitespace-nowrap"
                      >
                        <InlineRenderer text={header} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-white/[0.02]">
                      {block.headers.map((_, cIdx) => (
                        <td key={cIdx} className="px-3.5 py-2.5 text-slate-300 align-top">
                          <InlineRenderer text={row[cIdx] ?? ''} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === 'hr') {
          return <hr key={index} className="border-slate-200 dark:border-slate-800 my-4" />;
        }

        return null;
      })}
    </div>
  );
}
