export type HelyumeModelId = 'helyume-1-pro' | 'helyume-1-ultra';

export interface HelyumeModelConfig {
  id: HelyumeModelId;
  name: string;
  shortLabel: string;
  description: string;
  speedNote: string;
  backendModel: string;
}

export const HELYUME_MODELS: readonly HelyumeModelConfig[] = [
  {
    id: 'helyume-1-pro',
    name: 'Helyume 1 Pro',
    shortLabel: '1 Pro',
    description: 'Kapsamlı analiz, düzenli başlıklar ve derinlemesine özet',
    speedNote: 'Dengeli & Detaylı',
    backendModel: 'gemini-4-hydrogen',
  },
  {
    id: 'helyume-1-ultra',
    name: 'Helyume 1 Ultra',
    shortLabel: '1 Ultra',
    description: 'Minimum gecikme ile anlık araştırma ve yüksek hızlı özet',
    speedNote: 'Ultra Hızlı',
    backendModel: 'gemini-4-hydrogen',
  },
] as const;

export const DEFAULT_HELYUME_MODEL: HelyumeModelId = 'helyume-1-pro';

export function resolveHelyumeModel(id?: string | null): HelyumeModelConfig {
  const found = HELYUME_MODELS.find((m) => m.id === id);
  return found ?? HELYUME_MODELS[0];
}
