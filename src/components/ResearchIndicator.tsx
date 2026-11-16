import { BookOpen, Brain, Globe } from 'lucide-react';

interface ResearchIndicatorProps {
  phase: 'google' | 'wikipedia' | 'thinking';
  label: string;
}

export function ResearchIndicator({ phase, label }: ResearchIndicatorProps) {
  const Icon =
    phase === 'wikipedia' ? BookOpen : phase === 'thinking' ? Brain : Globe;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="research-status"
      data-phase={phase}
      className="py-1.5 space-y-3"
    >
      <div className="inline-flex items-center gap-2.5">
        <Icon className="w-4 h-4 text-slate-200 shrink-0" aria-hidden="true" />
        <span className="helyume-rgb-text text-[15px] font-semibold tracking-tight">
          {label}
        </span>
      </div>
      <div className="h-[2px] w-56 max-w-full overflow-hidden rounded-full bg-white/[0.08]">
        <div className="helyume-rgb-bar h-full w-full rounded-full" />
      </div>
      <div aria-hidden="true" className="space-y-2 pt-1 max-w-md">
        <div className="h-2.5 w-full rounded-full bg-white/[0.05] animate-pulse" />
        <div className="h-2.5 w-4/5 rounded-full bg-white/[0.04] animate-pulse" />
      </div>
    </div>
  );
}
