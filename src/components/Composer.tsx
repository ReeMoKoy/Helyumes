import { ArrowUp, Film, ImagePlus, Mic, Square, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { formatFileSize } from '../lib/media';
import type { HelyumeModelId } from '../lib/models';
import type { ChatAttachment } from '../lib/storage';
import { ComposerModelSelector } from './ModelSelector';

interface ComposerProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  selectedModel: HelyumeModelId;
  onSelectModel: (modelId: HelyumeModelId) => void;
  attachments: ChatAttachment[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (id: string) => void;
  attachmentError: string | null;
  onOpenLiveAssistant: () => void;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  selectedModel,
  onSelectModel,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  attachmentError,
  onOpenLiveAssistant,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 || attachments.length > 0;

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && canSend) {
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
    if (canSend) {
      onSubmit();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      onAddFiles(files);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAddFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="border-t border-white/[0.07] bg-[#06080d]/92 backdrop-blur-md px-4 sm:px-6 py-3.5">
      <form onSubmit={handleFormSubmit} className="mx-auto w-full max-w-3xl">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="rounded-2xl border border-white/[0.12] bg-[#0c1018] px-3.5 sm:px-4 py-3 shadow-[0_14px_44px_-18px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.05)] focus-within:border-white/[0.28] transition-colors"
        >
          {attachments.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="group relative flex items-center gap-2 rounded-xl border border-white/[0.12] bg-[#131926] pr-2 pl-1.5 py-1.5 max-w-[230px]"
                >
                  {att.kind === 'image' && att.previewUrl ? (
                    <img
                      src={att.previewUrl}
                      alt={att.name}
                      className="w-9 h-9 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-violet-500/20 text-violet-300 flex items-center justify-center shrink-0">
                      <Film className="w-4 h-4" aria-hidden="true" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-slate-200 truncate">{att.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {att.kind === 'video' ? 'Video' : 'Görsel'}
                      {att.sizeBytes ? ` · ${formatFileSize(att.sizeBytes)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(att.id)}
                    aria-label={`${att.name} eklentisini kaldır`}
                    className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {attachmentError ? (
            <p role="alert" className="mb-2 text-xs text-rose-300">
              {attachmentError}
            </p>
          ) : null}

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
            onPaste={handlePaste}
            placeholder="Bir mesaj, görsel veya video ekleyin..."
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none max-h-[180px]"
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onAddFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />

          <div className="mt-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <ComposerModelSelector
                selectedModel={selectedModel}
                onSelect={onSelectModel}
                disabled={isStreaming}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming || attachments.length >= 4}
                aria-label="Görsel veya video ekle"
                title="Görsel veya video ekle (PNG, JPG, MP4, WEBM)"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-white/[0.1] bg-white/[0.03] text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.08] disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer"
              >
                <ImagePlus className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
                <span className="hidden sm:inline">Görsel / Video</span>
              </button>
              <button
                type="button"
                onClick={onOpenLiveAssistant}
                disabled={isStreaming}
                aria-label="Sesli ve görüntülü canlı asistan"
                title="Sesli ve görüntülü canlı asistanı aç"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Canlı</span>
              </button>
            </div>

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
                disabled={!canSend}
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
