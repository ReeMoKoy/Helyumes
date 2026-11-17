export type ResearchPhase =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'done'
  | 'error';

export type SearchEngine = 'api';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type SseEvent =
  | { type: 'status'; phase: 'thinking'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; engine: SearchEngine | 'none'; durationMs: number }
  | { type: 'error'; message: string };

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
