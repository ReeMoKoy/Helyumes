export type ResearchPhase =
  | 'idle'
  | 'google'
  | 'wikipedia'
  | 'thinking'
  | 'streaming'
  | 'done'
  | 'error';

export type SearchEngine = 'google' | 'wikipedia' | 'api';

export interface ResearchSource {
  title: string;
  url: string;
  engine: 'google' | 'wikipedia';
  snippet?: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type SseEvent =
  | { type: 'status'; phase: 'google' | 'wikipedia' | 'thinking'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'sources'; engine: 'google' | 'wikipedia'; sources: ResearchSource[] }
  | { type: 'done'; engine: SearchEngine | 'none'; durationMs: number }
  | { type: 'error'; message: string };

export const GOOGLE_NOT_FOUND_TOKEN = '[GOOGLE_NOT_FOUND]';
export const WIKI_NOT_SUFFICIENT_TOKEN = '[WIKI_NOT_SUFFICIENT]';

export type PrefixDecision =
  | { action: 'hold' }
  | { action: 'not_found' }
  | { action: 'stream'; text: string };

/**
 * Buffers only enough initial characters to detect control markers
 * without delaying normal streaming tokens.
 */
export function evaluateStreamPrefix(
  buffer: string,
  marker: string = GOOGLE_NOT_FOUND_TOKEN
): PrefixDecision {
  const trimmedStart = buffer.trimStart();
  if (trimmedStart.length === 0) {
    return { action: 'hold' };
  }

  if (trimmedStart.startsWith(marker)) {
    return { action: 'not_found' };
  }

  if (marker.startsWith(trimmedStart)) {
    return { action: 'hold' };
  }

  return { action: 'stream', text: buffer };
}

interface RawGroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

interface RawGroundingMetadata {
  groundingChunks?: RawGroundingChunk[];
}

export function extractGoogleSources(groundingMetadata: unknown): ResearchSource[] {
  if (!groundingMetadata || typeof groundingMetadata !== 'object') {
    return [];
  }
  const meta = groundingMetadata as RawGroundingMetadata;
  if (!Array.isArray(meta.groundingChunks)) {
    return [];
  }

  const seen = new Set<string>();
  const sources: ResearchSource[] = [];

  for (const chunk of meta.groundingChunks) {
    const uri = chunk?.web?.uri?.trim();
    if (!uri || (!uri.startsWith('http://') && !uri.startsWith('https://'))) {
      continue;
    }
    if (seen.has(uri)) {
      continue;
    }
    seen.add(uri);
    const title = chunk?.web?.title?.trim() || extractHostname(uri);
    sources.push({
      title,
      url: uri,
      engine: 'google',
    });
  }

  return sources;
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function isUncertainReply(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  if (
    normalized.includes(GOOGLE_NOT_FOUND_TOKEN.toLowerCase()) ||
    normalized.includes(WIKI_NOT_SUFFICIENT_TOKEN.toLowerCase())
  ) {
    return true;
  }
  const uncertaintyPatterns = [
    'sonuç bulunamadı',
    'bilgi bulunamadı',
    'cevabı bulunmamaktadır',
    'cevap bulunamamaktadır',
    'yanıt bulunmamaktadır',
    'yer almamaktadır',
    'yer almıyor',
    'içermemektedir',
    'bahsedilmemektedir',
    'sağlanan kaynaklarda',
    'verilen kaynaklarda',
    'google aramasında',
    'doğrulanabilir kaynak bulunamadı',
    'yeterli bilgi yok',
  ];
  return normalized.length < 340 && uncertaintyPatterns.some((p) => normalized.includes(p));
}

export function buildWikipediaSearchUrl(query: string, lang: 'tr' | 'en'): string {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query.trim(),
    srlimit: '4',
    format: 'json',
    utf8: '1',
    origin: '*',
  });
  return `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`;
}

export function buildWikipediaExtractsUrl(pageIds: number[], lang: 'tr' | 'en'): string {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts|info',
    exintro: '1',
    explaintext: '1',
    exchars: '1200',
    inprop: 'url',
    pageids: pageIds.join('|'),
    format: 'json',
    utf8: '1',
    origin: '*',
  });
  return `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`;
}

export interface WikipediaArticle {
  pageId: number;
  title: string;
  url: string;
  extract: string;
  lang: 'tr' | 'en';
}

export function parseWikipediaSearchPageIds(payload: unknown): number[] {
  if (!payload || typeof payload !== 'object') return [];
  const query = (payload as { query?: { search?: Array<{ pageid?: number }> } }).query;
  if (!Array.isArray(query?.search)) return [];
  return query.search
    .map((item) => item.pageid)
    .filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
}

export function parseWikipediaExtracts(payload: unknown, lang: 'tr' | 'en'): WikipediaArticle[] {
  if (!payload || typeof payload !== 'object') return [];
  const pagesObj = (
    payload as {
      query?: {
        pages?: Record<
          string,
          {
            pageid?: number;
            title?: string;
            fullurl?: string;
            extract?: string;
          }
        >;
      };
    }
  ).query?.pages;

  if (!pagesObj || typeof pagesObj !== 'object') return [];

  const articles: WikipediaArticle[] = [];
  for (const page of Object.values(pagesObj)) {
    const title = page.title?.trim();
    const extract = page.extract?.trim();
    const pageId = page.pageid;
    if (!title || !extract || typeof pageId !== 'number') continue;
    const url =
      page.fullurl?.trim() ||
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
    articles.push({
      pageId,
      title,
      url,
      extract,
      lang,
    });
  }
  return articles;
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
    return 'Servis erişim anahtarı geçersiz veya yetkisiz. Lütfen Settings > Secrets panelinden anahtarınızı kontrol edin.';
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

export function hasRelevantWikipediaMatch(
  query: string,
  articles: WikipediaArticle[]
): boolean {
  const words = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (words.length === 0 || articles.length === 0) return false;

  return articles.some((a) => {
    const titleLower = a.title.toLowerCase();
    return words.some((w) => titleLower.includes(w));
  });
}

export function buildExtractiveWikipediaSummary(articles: WikipediaArticle[]): string {
  if (articles.length === 0) return '';
  const intro =
    'Yoğunluk nedeniyle **Wikipedia** üzerinden bulunan özet bilgiler aşağıda listelenmiştir:\n\n';
  const sections = articles
    .slice(0, 3)
    .map((a) => `### ${a.title}\n${a.extract}`)
    .join('\n\n');
  return intro + sections;
}
