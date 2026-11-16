import {
  buildWikipediaExtractsUrl,
  buildWikipediaSearchUrl,
  parseWikipediaExtracts,
  parseWikipediaSearchPageIds,
  type WikipediaArticle,
} from '../src/lib/research.ts';

async function searchWikipediaLang(
  query: string,
  lang: 'tr' | 'en'
): Promise<WikipediaArticle[]> {
  const searchUrl = buildWikipediaSearchUrl(query, lang);
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'HelyumeResearchAssistant/1.0 (https://helyume.app)',
  };

  const searchRes = await fetch(searchUrl, {
    headers,
    signal: AbortSignal.timeout(4500),
  });

  if (!searchRes.ok) {
    return [];
  }

  const searchJson = (await searchRes.json()) as unknown;
  const pageIds = parseWikipediaSearchPageIds(searchJson);
  if (pageIds.length === 0) {
    return [];
  }

  const extractsUrl = buildWikipediaExtractsUrl(pageIds, lang);
  const extractsRes = await fetch(extractsUrl, {
    headers,
    signal: AbortSignal.timeout(4500),
  });

  if (!extractsRes.ok) {
    return [];
  }

  const extractsJson = (await extractsRes.json()) as unknown;
  return parseWikipediaExtracts(extractsJson, lang);
}

export async function searchWikipedia(query: string): Promise<WikipediaArticle[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const trArticles = await searchWikipediaLang(trimmed, 'tr');
    if (trArticles.length > 0) {
      return trArticles;
    }

    const enArticles = await searchWikipediaLang(trimmed, 'en');
    return enArticles;
  } catch {
    return [];
  }
}
