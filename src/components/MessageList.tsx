import { Check, Copy, Film, Image as ImageIcon, RotateCcw } from 'lucide-react';
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
      className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
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
          const hasLiveAttachments = Boolean(msg.attachments && msg.attachments.length > 0);
          return (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-[#141a27] border border-white/[0.1] px-4 py-3 text-[15px] leading-relaxed text-slate-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] space-y-2.5">
                {hasLiveAttachments ? (
                  <div className="flex flex-wrap gap-2">
                    {msg.attachments!.map((att) =>
                      att.kind === 'image' && att.previewUrl ? (
                        <img
                          key={att.id}
                          src={att.previewUrl}
                          alt={att.name}
                          className="max-h-56 max-w-full rounded-xl border border-white/[0.1] object-contain bg-black/30"
                        />
                      ) : att.kind === 'video' && att.previewUrl ? (
                        <video
                          key={att.id}
                          src={att.previewUrl}
                          controls
                          playsInline
                          className="max-h-56 max-w-full rounded-xl border border-white/[0.1] bg-black"
                        />
                      ) : (
                        <span
                          key={att.id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs text-slate-300"
                        >
                          {att.kind === 'video' ? (
                            <Film className="w-3.5 h-3.5 text-violet-300" />
                          ) : (
                            <ImageIcon className="w-3.5 h-3.5 text-cyan-300" />
                          )}
                          <span>{att.name}</span>
                        </span>
                      )
                    )}
                  </div>
                ) : msg.attachmentSummary ? (
                  <div className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs text-slate-300">
                    <ImageIcon className="w-3.5 h-3.5 text-cyan-300 shrink-0" aria-hidden="true" />
                    <span>{msg.attachmentSummary}</span>
                  </div>
                ) : null}
                {msg.content ? <p className="whitespace-pre-wrap">{msg.content}</p> : null}
              </div>
            </div>
          );
        }

        const modelInfo = resolveHelyumeModel(msg.model);
        const showStatusInWritingArea =
          msg.phase === 'thinking' && msg.content.trim().length === 0;

        return (
          <article
            key={msg.id}
            aria-label="Helyume yanıtı"
            className="flex items-start gap-3.5"
          >
            <div className="shrink-0 mt-0.5">
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
                  <ResearchIndicator label={msg.statusLabel || 'Düşünüyor...'} />
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
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/25 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Tekrar Dene</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {msg.phase === 'done' && msg.content ? (
                <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-400">
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
