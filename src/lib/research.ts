export type ResearchPhase =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'done'
  | 'error';

export type SearchEngine = 'api';

export type AttachmentKind = 'image' | 'video';

export interface MediaAttachmentInput {
  kind: AttachmentKind;
  mimeType: string;
  dataBase64: string;
  name?: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  attachments?: MediaAttachmentInput[];
}

export type SseEvent =
  | { type: 'status'; phase: 'thinking'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; engine: SearchEngine | 'none'; durationMs: number }
  | { type: 'error'; message: string };

const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

export function isValidMediaAttachment(raw: unknown): raw is MediaAttachmentInput {
  if (!raw || typeof raw !== 'object') return false;
  const att = raw as Partial<MediaAttachmentInput>;
  if (att.kind !== 'image' && att.kind !== 'video') return false;
  if (typeof att.mimeType !== 'string' || typeof att.dataBase64 !== 'string') return false;
  if (att.dataBase64.length === 0 || att.dataBase64.length > 16_000_000) return false;
  const mime = att.mimeType.toLowerCase();
  if (att.kind === 'image' && !ALLOWED_IMAGE_MIMES.has(mime)) return false;
  if (att.kind === 'video' && !ALLOWED_VIDEO_MIMES.has(mime)) return false;
  return true;
}

export function sanitizeChatTurns(rawMessages: unknown): ChatTurn[] {
  if (!Array.isArray(rawMessages)) return [];
  const result: ChatTurn[] = [];
  for (const item of rawMessages) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { role?: unknown; content?: unknown; attachments?: unknown };
    if (candidate.role !== 'user' && candidate.role !== 'assistant') continue;
    const content = typeof candidate.content === 'string' ? candidate.content : '';
    const attachments = Array.isArray(candidate.attachments)
      ? candidate.attachments.filter(isValidMediaAttachment).slice(0, 4)
      : [];
    if (content.trim().length === 0 && attachments.length === 0) continue;
    result.push({
      role: candidate.role,
      content,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  }
  return result.slice(-16);
}

const FAST_CASUAL_EXACT_PHRASES = new Set([
  'selam',
  'slm',
  'sa',
  'merhaba',
  'mrb',
  'hey',
  'hi',
  'hello',
  'naber',
  'nbr',
  'naparsın',
  'napıyorsun',
  'ne yapıyorsun',
  'nasılsın',
  'nasılsınız',
  'iyi misin',
  'günaydın',
  'tünaydın',
  'iyi akşamlar',
  'iyi geceler',
  'teşekkürler',
  'teşekkür ederim',
  'teşekkür',
  'sağ ol',
  'sağol',
  'eyvallah',
  'tamam',
  'olur',
  'peki',
  'evet',
  'hayır',
  'görüşürüz',
  'hoşçakal',
  'bay bay',
  'bye',
  'kimsin',
  'sen kimsin',
  'adın ne',
  'ismin ne',
]);

/**
 * Returns true for short greetings, pleasantries, and casual check-ins
 * that benefit from sub-second minimal-thinking responses.
 */
export function isFastCasualPrompt(query: string): boolean {
  const normalized = query
    .trim()
    .toLowerCase()
    .replace(/[?!.,;:()[\]{}"'’]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized || normalized.length > 60) return false;
  if (FAST_CASUAL_EXACT_PHRASES.has(normalized)) return true;

  const words = normalized.split(' ').filter(Boolean);
  if (words.length <= 5) {
    return (
      /^(selam|slm|merhaba|mrb|hey|hi|hello|günaydın|iyi akşamlar|iyi geceler)\b/i.test(
        normalized
      ) || /\b(naparsın|napıyorsun|ne yapıyorsun|naber|nasılsın|iyi misin)\b/i.test(normalized)
    );
  }
  return false;
}

export function parseSseChunk(
  chunk: string,
  carry: string
): { events: SseEvent[]; carry: string } {
  const combined = carry + chunk;
  const blocks = combined.split('\n\n');
  const nextCarry = blocks.pop() ?? '';
  const events: SseEvent[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    try {
      const parsed = JSON.parse(dataLines.join('\n')) as SseEvent;
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        events.push(parsed);
      }
    } catch {
      // Ignore malformed partial frame
    }
  }

  return { events, carry: nextCarry };
}

export function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('Service Unavailable') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('500') ||
    msg.includes('INTERNAL') ||
    msg.includes('DEADLINE_EXCEEDED')
  );
}

export function formatFriendlyApiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const normalized = raw.trim();

  if (
    normalized.includes('API_KEY_INVALID') ||
    normalized.includes('PERMISSION_DENIED') ||
    normalized.includes('403')
  ) {
    return 'Servis erişim anahtarı geçersiz veya yetkisiz. Lütfen ortam değişkenlerini kontrol edin.';
  }

  if (normalized.includes('429') || normalized.includes('RESOURCE_EXHAUSTED')) {
    return 'Yoğun istek nedeniyle geçici bir bekleme oluştu. Birkaç saniye bekleyip Tekrar Dene butonuna basabilirsiniz.';
  }

  if (isTransientGeminiError(normalized)) {
    return 'Sunucuda şu anda yoğunluk yaşanıyor (503). Lütfen birkaç saniye sonra Tekrar Dene butonuna tıklayın.';
  }

  if (!normalized || normalized.startsWith('{')) {
    return 'Yanıt üretilirken geçici bir sunucu hatası oluştu. Lütfen tekrar deneyin.';
  }

  return normalized;
}
