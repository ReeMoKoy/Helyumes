export type HelyumeModelId = 'helyume-crush' | 'helyume-aura' | 'helyume-void';

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
    id: 'helyume-crush',
    name: 'Helyume Crush',
    shortLabel: 'Crush',
    description: 'Anında hız, net özetler ve doğrudan çözüm odaklı pratik yanıtlar',
    speedNote: 'Ultra Hızlı',
    backendModel: 'gemini-3.1-flash-lite',
  },
  {
    id: 'helyume-aura',
    name: 'Helyume Aura',
    shortLabel: 'Aura',
    description: 'Günlük sohbet, planlama ve yaratıcı fikirlerde dengeli akıl yürütme',
    speedNote: 'Dengeli',
    backendModel: 'gemini-4-hydrogen',
  },
  {
    id: 'helyume-void',
    name: 'Helyume Void',
    shortLabel: 'Void',
    description: 'Karmaşık teknik sorular, derin analiz ve kapsamlı stratejik çözümleme',
    speedNote: 'Derin Analiz',
    backendModel: 'gemini-4-hydrogen',
  },
] as const;

export const DEFAULT_HELYUME_MODEL: HelyumeModelId = 'helyume-aura';

export function resolveHelyumeModel(id?: string | null): HelyumeModelConfig {
  if (id === 'helyume-1-pro') return HELYUME_MODELS[1];
  if (id === 'helyume-1-ultra') return HELYUME_MODELS[2];
  const found = HELYUME_MODELS.find((m) => m.id === id);
  return found ?? HELYUME_MODELS[1];
}
