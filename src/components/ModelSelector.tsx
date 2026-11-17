import { Flame, Orbit, Sparkles } from 'lucide-react';
import { HELYUME_MODELS, type HelyumeModelId } from '../lib/models';

interface ComposerModelSelectorProps {
  selectedModel: HelyumeModelId;
  onSelect: (modelId: HelyumeModelId) => void;
  disabled?: boolean;
}

export function ComposerModelSelector({
  selectedModel,
  onSelect,
  disabled = false,
}: ComposerModelSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Model seçimi"
      className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.08]"
    >
      {HELYUME_MODELS.map((model) => {
        const isActive = model.id === selectedModel;
        const Icon =
          model.id === 'helyume-crush'
            ? Flame
            : model.id === 'helyume-void'
              ? Orbit
              : Sparkles;
        const activeIconColor =
          model.id === 'helyume-crush'
            ? 'text-rose-400'
            : model.id === 'helyume-void'
              ? 'text-violet-300'
              : 'text-cyan-300';

        return (
          <button
            key={model.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onSelect(model.id)}
            title={`${model.name} (${model.speedNote}) — ${model.description}`}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded-lg transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-60 cursor-pointer ${
              isActive
                ? 'bg-white/[0.13] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon
              className={`w-3.5 h-3.5 shrink-0 ${isActive ? activeIconColor : ''}`}
              aria-hidden="true"
            />
            <span>{model.name}</span>
          </button>
        );
      })}
    </div>
  );
}
