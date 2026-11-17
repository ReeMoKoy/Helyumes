import { Sparkles } from 'lucide-react';

interface ResearchIndicatorProps {
  label?: string;
}

export function ResearchIndicator({ label = 'Düşünüyor...' }: ResearchIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="research-status"
      data-phase="thinking"
      className="py-1.5 space-y-2.5"
    >
      <div className="inline-flex items-center gap-2.5">
        <Sparkles className="w-4 h-4 text-cyan-300 shrink-0" aria-hidden="true" />
        <span className="helyume-rgb-text text-[15px] font-semibold tracking-tight">
          {label}
        </span>
      </div>
      <div className="h-[2px] w-48 max-w-full overflow-hidden rounded-full bg-white/[0.08]">
        <div className="helyume-rgb-bar h-full w-full rounded-full" />
      </div>
    </div>
  );
}
