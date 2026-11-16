import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HELYUME_MODEL,
  HELYUME_MODELS,
  resolveHelyumeModel,
} from './models';
import {
  GOOGLE_NOT_FOUND_TOKEN,
  WIKI_NOT_SUFFICIENT_TOKEN,
  buildExtractiveWikipediaSummary,
  buildWikipediaExtractsUrl,
  buildWikipediaSearchUrl,
  evaluateStreamPrefix,
  extractGoogleSources,
  formatFriendlyApiError,
  hasRelevantWikipediaMatch,
  isTransientGeminiError,
  isUncertainReply,
  parseSseChunk,
  parseWikipediaExtracts,
  parseWikipediaSearchPageIds,
} from './research';
import { parseInlineMarkdown, parseMarkdownBlocks } from './markdown';
import { GET as healthGet } from '../../api/health';
import { POST as chatPost } from '../../api/chat';

test('model registry contains Helyume 1 Pro and Helyume 1 Ultra', () => {
  assert.equal(HELYUME_MODELS.length, 2);
  assert.equal(HELYUME_MODELS[0].name, 'Helyume 1 Pro');
  assert.equal(HELYUME_MODELS[1].name, 'Helyume 1 Ultra');
  assert.equal(resolveHelyumeModel('helyume-1-ultra').name, 'Helyume 1 Ultra');
  assert.equal(resolveHelyumeModel('unknown').id, DEFAULT_HELYUME_MODEL);
});

test('evaluateStreamPrefix holds partial marker and detects [GOOGLE_NOT_FOUND] and [WIKI_NOT_SUFFICIENT]', () => {
  assert.equal(evaluateStreamPrefix('   ').action, 'hold');
  assert.equal(evaluateStreamPrefix('[GOOGLE_NOT').action, 'hold');
  assert.equal(evaluateStreamPrefix(GOOGLE_NOT_FOUND_TOKEN).action, 'not_found');
  assert.equal(evaluateStreamPrefix('[WIKI_NOT', WIKI_NOT_SUFFICIENT_TOKEN).action, 'hold');
  assert.equal(
    evaluateStreamPrefix(WIKI_NOT_SUFFICIENT_TOKEN, WIKI_NOT_SUFFICIENT_TOKEN).action,
    'not_found'
  );
  assert.equal(isUncertainReply('Sağlanan kaynaklarda bu sorunun cevabı bulunmamaktadır.'), true);
  const normal = evaluateStreamPrefix('Kuantum bilgisayarlar');
  assert.deepEqual(normal, { action: 'stream', text: 'Kuantum bilgisayarlar' });
});

test('extractGoogleSources deduplicates and filters invalid URLs', () => {
  const sources = extractGoogleSources({
    groundingChunks: [
      { web: { uri: 'https://tr.wikipedia.org/wiki/Kuantum', title: 'Kuantum - Wikipedia' } },
      { web: { uri: 'https://tr.wikipedia.org/wiki/Kuantum', title: 'Duplicate' } },
      { web: { uri: 'javascript:alert(1)', title: 'Bad' } },
      { web: { uri: 'https://tubitak.gov.tr/bilim' } },
    ],
  });

  assert.equal(sources.length, 2);
  assert.equal(sources[0].engine, 'google');
  assert.equal(sources[0].title, 'Kuantum - Wikipedia');
  assert.equal(sources[1].title, 'tubitak.gov.tr');
});

test('Wikipedia URL builders and extract parser work for Turkish and English', () => {
  const searchUrl = buildWikipediaSearchUrl('Atatürk', 'tr');
  assert.match(searchUrl, /^https:\/\/tr\.wikipedia\.org\/w\/api\.php\?/);
  assert.match(searchUrl, /list=search/);

  const pageIds = parseWikipediaSearchPageIds({
    query: { search: [{ pageid: 101 }, { pageid: 202 }] },
  });
  assert.deepEqual(pageIds, [101, 202]);

  const extractsUrl = buildWikipediaExtractsUrl(pageIds, 'tr');
  assert.match(extractsUrl, /pageids=101%7C202/);

  const articles = parseWikipediaExtracts(
    {
      query: {
        pages: {
          '101': {
            pageid: 101,
            title: 'Mustafa Kemal Atatürk',
            fullurl: 'https://tr.wikipedia.org/wiki/Mustafa_Kemal_Atat%C3%BCrk',
            extract: 'Türkiye Cumhuriyeti kurucusu.',
          },
        },
      },
    },
    'tr'
  );
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, 'Mustafa Kemal Atatürk');
  assert.equal(articles[0].lang, 'tr');
});

test('parseSseChunk handles split frames across chunks without JSONL', () => {
  const part1 = 'data: {"type":"status","phase":"google","label":"Google\'da Araştırılıyor..."}\n\ndata: {"type":"de';
  const part2 =
    'lta","text":"Merhaba"}\n\ndata: {"type":"status","phase":"thinking","label":"Bir Süre Düşünüyor..."}\n\n';

  const res1 = parseSseChunk(part1, '');
  assert.equal(res1.events.length, 1);
  assert.equal(res1.events[0].type, 'status');

  const res2 = parseSseChunk(part2, res1.carry);
  assert.equal(res2.events.length, 2);
  assert.deepEqual(res2.events[0], { type: 'delta', text: 'Merhaba' });
  assert.deepEqual(res2.events[1], {
    type: 'status',
    phase: 'thinking',
    label: 'Bir Süre Düşünüyor...',
  });
  assert.equal(res2.carry, '');
});

test('parseMarkdownBlocks and parseInlineMarkdown render headings, lists, and links', () => {
  const md = [
    '### Özet',
    '',
    'Bu **önemli** bir [kaynak](https://example.com) ve `kod`.',
    '',
    '- Madde bir',
    '- Madde iki',
  ].join('\n');

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], { type: 'heading', level: 3, text: 'Özet' });
  assert.deepEqual(blocks[2], { type: 'ul', items: ['Madde bir', 'Madde iki'] });

  const inline = parseInlineMarkdown('Bu **önemli** bir [kaynak](https://example.com) ve `kod`.');
  assert.equal(inline.some((s) => s.type === 'bold' && s.text === 'önemli'), true);
  assert.equal(inline.some((s) => s.type === 'link' && s.url === 'https://example.com'), true);
  assert.equal(inline.some((s) => s.type === 'code' && s.text === 'kod'), true);
});

test('isTransientGeminiError and formatFriendlyApiError translate raw 503 JSON cleanly', () => {
  const raw503 = new Error(
    '{"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 503,\\n    \\"message\\": \\"This model is currently experiencing high demand.\\",\\n    \\"status\\": \\"UNAVAILABLE\\"\\n  }\\n}","code":503,"status":"Service Unavailable"}}'
  );
  assert.equal(isTransientGeminiError(raw503), true);
  const friendly = formatFriendlyApiError(raw503);
  assert.doesNotMatch(friendly, /UNAVAILABLE/);
  assert.match(friendly, /503/);
  assert.match(friendly, /yoğunluk/);
});

test('buildExtractiveWikipediaSummary and hasRelevantWikipediaMatch check title relevance', () => {
  const frictionArticle = {
    pageId: 1,
    title: 'Sürtünme kuvveti',
    url: 'https://tr.wikipedia.org/wiki/S%C3%BCrt%C3%BCnme_kuvveti',
    extract: 'Temas eden iki yüzey arasında harekete karşı koyan kuvvettir.',
    lang: 'tr' as const,
  };
  assert.equal(hasRelevantWikipediaMatch('Sürtünme kuvveti ne', [frictionArticle]), true);
  assert.equal(hasRelevantWikipediaMatch('Bugün akşam ne yemek yapayım?', [frictionArticle]), false);

  const text = buildExtractiveWikipediaSummary([frictionArticle]);
  assert.match(text, /### Sürtünme kuvveti/);
  assert.match(text, /harekete karşı koyan kuvvettir/);
});

test('Vercel serverless /api/health and /api/chat handlers validate inputs cleanly', async () => {
  const healthRes = healthGet();
  assert.equal(healthRes.status, 200);
  const healthData = (await healthRes.json()) as { ok: boolean; service: string };
  assert.deepEqual(healthData, { ok: true, service: 'helyume' });

  const invalidJsonReq = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid-json',
  });
  const invalidJsonRes = await chatPost(invalidJsonReq);
  assert.equal(invalidJsonRes.status, 400);
  const invalidJsonData = (await invalidJsonRes.json()) as { error: string };
  assert.match(invalidJsonData.error, /JSON/);

  const emptyMsgsReq = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [], model: 'helyume-1-ultra' }),
  });
  const emptyMsgsRes = await chatPost(emptyMsgsReq);
  assert.equal(emptyMsgsRes.status, 400);
  const emptyMsgsData = (await emptyMsgsRes.json()) as { error: string };
  assert.match(emptyMsgsData.error, /mesaj/);
});
