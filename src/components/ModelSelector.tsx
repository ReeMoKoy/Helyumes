import { Layers, Zap } from 'lucide-react';
import { HELYUME_MODELS, type HelyumeModelId } from '../lib/models';

interface ModelSelectorProps {
  selectedModel: HelyumeModelId;
  onSelect: (modelId: HelyumeModelId) => void;
  disabled?: boolean;
}

export function TopBarModelSelector({
  selectedModel,
  onSelect,
  disabled = false,
}: ModelSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Model seçimi"
      className="inline-flex items-center p-1 rounded-xl bg-white/[0.04] border border-white/[0.08]"
    >
      {HELYUME_MODELS.map((model) => {
        const isActive = model.id === selectedModel;
        const Icon = model.id === 'helyume-1-ultra' ? Zap : Layers;
        return (
          <button
            key={model.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onSelect(model.id)}
            className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded-lg transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-60 ${
              isActive
                ? 'bg-white/[0.12] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon
              className={`w-3.5 h-3.5 shrink-0 ${
                isActive && model.id === 'helyume-1-ultra'
                  ? 'text-amber-300'
                  : isActive
                    ? 'text-sky-300'
                    : ''
              }`}
              aria-hidden="true"
            />
            <span>{model.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function EmptyStateModelCards({
  selectedModel,
  onSelect,
}: ModelSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Helyume model seçenekleri"
      className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl"
    >
      {HELYUME_MODELS.map((model) => {
        const isActive = model.id === selectedModel;
        const Icon = model.id === 'helyume-1-ultra' ? Zap : Layers;
        return (
          <button
            key={model.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onSelect(model.id)}
            className={`relative overflow-hidden text-left p-4 rounded-2xl border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
              isActive
                ? 'bg-[#0f1520] border-white/25 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.8),inset_0_1px_0_0_rgba(255,255,255,0.08)]'
                : 'bg-[#0b0f17] border-white/[0.08] hover:border-white/[0.16] hover:bg-[#0e131d]'
            }`}
          >
            {isActive ? (
              <span
                aria-hidden="true"
                className="helyume-rgb-bar absolute inset-x-0 top-0 h-[2px]"
              />
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive && model.id === 'helyume-1-ultra'
                      ? 'text-amber-300'
                      : isActive
                        ? 'text-sky-300'
                        : 'text-slate-400'
                  }`}
                  aria-hidden="true"
                />
                <span className="font-display text-sm font-semibold text-white whitespace-nowrap">
                  {model.name}
                </span>
              </div>
              <span className="text-xs text-slate-400 whitespace-nowrap">
                {model.speedNote}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {model.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
