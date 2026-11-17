import type { HelyumeModelId } from './models';
import type { ResearchPhase, SearchEngine } from './research';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: HelyumeModelId;
  phase?: ResearchPhase;
  statusLabel?: string;
  engine?: SearchEngine | 'none';
  durationMs?: number;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: HelyumeModelId;
  updatedAt: number;
  messages: ChatMessage[];
}

const STORAGE_KEY = 'helyume_conversations_v1';

export function deriveConversationTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= 44) return cleaned || 'Yeni Sohbet';
  return `${cleaned.slice(0, 41)}...`;
}

export function loadConversations(): Conversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Conversation =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as Conversation).id === 'string' &&
        Array.isArray((item as Conversation).messages)
    );
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    // Ignore storage quota errors
  }
}
