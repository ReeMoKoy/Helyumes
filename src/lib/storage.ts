import type { HelyumeModelId } from './models';
import type { AttachmentKind, ResearchPhase, SearchEngine } from './research';

export interface ChatAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  previewUrl?: string;
  dataBase64?: string;
}

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
  attachments?: ChatAttachment[];
  attachmentSummary?: string;
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

export function buildAttachmentSummary(attachments?: ChatAttachment[]): string | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  const summary = attachments
    .map((att) => `${att.kind === 'video' ? 'Video' : 'Görsel'}: ${att.name}`)
    .join(', ');
  return summary.slice(0, 300);
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
    const compact = conversations.map((conv) => ({
      ...conv,
      messages: conv.messages.map((msg) => ({
        ...msg,
        attachments: msg.attachments?.map((att) => ({
          id: att.id,
          kind: att.kind,
          name: att.name,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
        })),
      })),
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // Ignore storage quota errors
  }
}
