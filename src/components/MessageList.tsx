import { Check, Copy, ExternalLink, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { resolveHelyumeModel } from '../lib/models';
import type { ChatMessage } from '../lib/storage';
import { HelyumeLogo } from './HelyumeLogo';
import { MarkdownContent } from './MarkdownContent';
import { ResearchIndicator } from './ResearchIndicator';

interface MessageListProps {
  messages: ChatMessage[];
  onRetry?: (assistantMessageId: string) => void;
}

function CopyResponseButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Yanıtı kopyala"
      className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
    </button>
  );
}

export function MessageList({ messages, onRetry }: MessageListProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-8 space-y-8">
      {messages.map((msg) => {
        if (msg.role === 'user') {
          return (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-white/[0.08] border border-white/[0.11] px-4 py-3 text-[15px] leading-relaxed text-slate-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          );
        }

        const modelInfo = resolveHelyumeModel(msg.model);
        const isResearching =
          msg.phase === 'google' || msg.phase === 'wikipedia' || msg.phase === 'thinking';
        const showStatusInWritingArea = isResearching && msg.content.trim().length === 0;
        const engineLabel =
          msg.engine === 'wikipedia'
            ? 'Wikipedia'
            : msg.engine === 'google'
              ? 'Google Arama'
              : null;

        const indicatorPhase: 'google' | 'wikipedia' | 'thinking' =
          msg.phase === 'wikipedia'
            ? 'wikipedia'
            : msg.phase === 'thinking'
              ? 'thinking'
              : 'google';

        const defaultIndicatorLabel =
          indicatorPhase === 'wikipedia'
            ? "Wikipedia'da Araştırılıyor..."
            : indicatorPhase === 'thinking'
              ? 'Bir Süre Düşünüyor...'
              : "Google'da Araştırılıyor...";

        return (
          <article
            key={msg.id}
            aria-label="Helyume yanıtı"
            className="flex items-start gap-3.5"
          >
            <div className="shrink-0 mt-0.5 rounded-xl p-[1px] bg-gradient-to-br from-white/20 to-white/5">
              <HelyumeLogo className="w-7 h-7 block" />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="font-display font-semibold text-sm text-white">
                  Helyume
                </span>
                <span aria-hidden="true">·</span>
                <span>{modelInfo.name}</span>
              </div>

              <div className="min-h-[28px]">
                {showStatusInWritingArea ? (
                  <ResearchIndicator
                    phase={indicatorPhase}
                    label={msg.statusLabel || defaultIndicatorLabel}
                  />
                ) : null}

                {msg.content ? <MarkdownContent content={msg.content} /> : null}

                {msg.error ? (
                  <div
                    role="alert"
                    className="mt-2 rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3.5 text-sm text-red-200"
                  >
                    <p className="leading-relaxed">{msg.error}</p>
                    {onRetry ? (
                      <button
                        type="button"
                        onClick={() => onRetry(msg.id)}
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/25 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Tekrar Dene</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {msg.sources && msg.sources.length > 0 && (msg.content.length > 0 || msg.phase === 'done') ? (
                <div className="pt-3 border-t border-white/[0.08]">
                  <p className="text-xs font-medium text-slate-400 mb-2">
                    Kaynaklar
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {msg.sources.map((src, idx) => (
                      <a
                        key={src.url}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#0d1119] px-3 py-2 text-xs text-slate-300 hover:border-white/[0.2] hover:text-white transition-colors"
                      >
                        <span className="min-w-0 flex items-center gap-2">
                          <span className="tabular-nums text-slate-500 shrink-0">
                            [{idx + 1}]
                          </span>
                          <span className="truncate">{src.title}</span>
                        </span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0 text-slate-500 group-hover:text-slate-200 transition-colors" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              {msg.phase === 'done' && msg.content ? (
                <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-400">
                  {engineLabel ? (
                    <>
                      <span>{engineLabel}</span>
                      <span aria-hidden="true">·</span>
                    </>
                  ) : null}
                  {typeof msg.durationMs === 'number' ? (
                    <>
                      <span className="tabular-nums">
                        {(msg.durationMs / 1000).toFixed(1)} sn
                      </span>
                      <span aria-hidden="true">·</span>
                    </>
                  ) : null}
                  <CopyResponseButton text={msg.content} />
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
