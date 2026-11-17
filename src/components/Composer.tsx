import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import type { HelyumeModelId } from '../lib/models';
import { ComposerModelSelector } from './ModelSelector';

interface ComposerProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  selectedModel: HelyumeModelId;
  onSelectModel: (modelId: HelyumeModelId) => void;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  selectedModel,
  onSelectModel,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && value.trim()) {
        onSubmit();
      }
    }
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isStreaming) {
      onStop();
      return;
    }
    if (value.trim()) {
      onSubmit();
    }
  };

  return (
    <div className="border-t border-white/[0.07] bg-[#06080d]/92 backdrop-blur-md px-4 sm:px-6 py-3.5">
      <form onSubmit={handleFormSubmit} className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border border-white/[0.12] bg-[#0c1018] px-3.5 sm:px-4 py-3 shadow-[0_14px_44px_-18px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.05)] focus-within:border-white/[0.28] transition-colors">
          <label htmlFor="helyume-prompt-input" className="sr-only">
            Helyume&apos;e mesaj yazın
          </label>
          <textarea
            ref={textareaRef}
            id="helyume-prompt-input"
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Bir mesaj veya soru yazın..."
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none max-h-[180px]"
          />
          <div className="mt-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
            <ComposerModelSelector
              selectedModel={selectedModel}
              onSelect={onSelectModel}
              disabled={isStreaming}
            />

            {isStreaming ? (
              <button
                type="submit"
                aria-label="Yanıtı durdur"
                className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                <span>Durdur</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!value.trim()}
                aria-label="Gönder"
                className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold bg-white text-slate-950 hover:bg-slate-200 disabled:opacity-35 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Gönder</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
