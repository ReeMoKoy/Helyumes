import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HELYUME_MODEL,
  HELYUME_MODELS,
  resolveHelyumeModel,
} from './models';
import {
  formatFriendlyApiError,
  isFastCasualPrompt,
  isTransientGeminiError,
  parseSseChunk,
} from './research';
import { parseInlineMarkdown, parseMarkdownBlocks } from './markdown';
import { deriveConversationTitle } from './storage';
import { GET as healthGet } from '../../api/health';
import { POST as chatPost } from '../../api/chat';

test('model registry contains Helyume Crush, Helyume Aura, and Helyume Void with legacy mapping', () => {
  assert.equal(HELYUME_MODELS.length, 3);
  assert.deepEqual(
    HELYUME_MODELS.map((m) => m.name),
    ['Helyume Crush', 'Helyume Aura', 'Helyume Void']
  );
  assert.equal(DEFAULT_HELYUME_MODEL, 'helyume-aura');
  assert.equal(resolveHelyumeModel('helyume-crush').name, 'Helyume Crush');
  assert.equal(resolveHelyumeModel('helyume-aura').name, 'Helyume Aura');
  assert.equal(resolveHelyumeModel('helyume-void').name, 'Helyume Void');
  assert.equal(resolveHelyumeModel('helyume-1-pro').id, 'helyume-aura');
  assert.equal(resolveHelyumeModel('helyume-1-ultra').id, 'helyume-void');
  assert.equal(resolveHelyumeModel('unknown').id, DEFAULT_HELYUME_MODEL);
});

test('isFastCasualPrompt identifies short greetings vs structured planning or factual prompts', () => {
  assert.equal(isFastCasualPrompt('selam'), true);
  assert.equal(isFastCasualPrompt('selam naparsın'), true);
  assert.equal(isFastCasualPrompt('Merhaba nasılsın?'), true);
  assert.equal(isFastCasualPrompt('Bugün için çalışma planı hazırla'), false);
  assert.equal(isFastCasualPrompt('Kuantum bilgisayar nedir?'), false);
  assert.equal(isFastCasualPrompt('TypeScript ile debounce fonksiyonu yaz'), false);
});

test('parseSseChunk handles split frames across chunks for thinking status and deltas', () => {
  const part1 =
    'data: {"type":"status","phase":"thinking","label":"Düşünüyor..."}\n\ndata: {"type":"de';
  const part2 =
    'lta","text":"Merhaba"}\n\ndata: {"type":"done","engine":"api","durationMs":420}\n\n';

  const res1 = parseSseChunk(part1, '');
  assert.equal(res1.events.length, 1);
  assert.deepEqual(res1.events[0], {
    type: 'status',
    phase: 'thinking',
    label: 'Düşünüyor...',
  });

  const res2 = parseSseChunk(part2, res1.carry);
  assert.equal(res2.events.length, 2);
  assert.deepEqual(res2.events[0], { type: 'delta', text: 'Merhaba' });
  assert.deepEqual(res2.events[1], {
    type: 'done',
    engine: 'api',
    durationMs: 420,
  });
  assert.equal(res2.carry, '');
});

test('parseMarkdownBlocks and parseInlineMarkdown render headings, lists, tables, and links', () => {
  const md = [
    '### Özet',
    '',
    'Bu **önemli** bir [kaynak](https://example.com) ve `kod`.',
    '',
    '| Özellik | Değer |',
    '| :--- | :--- |',
    '| Hız | Yüksek |',
    '',
    '- Madde bir',
    '- Madde iki',
  ].join('\n');

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks[0], { type: 'heading', level: 3, text: 'Özet' });
  assert.deepEqual(blocks[2], {
    type: 'table',
    headers: ['Özellik', 'Değer'],
    rows: [['Hız', 'Yüksek']],
  });
  assert.deepEqual(blocks[3], { type: 'ul', items: ['Madde bir', 'Madde iki'] });

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

test('deriveConversationTitle normalizes whitespace and truncates cleanly', () => {
  assert.equal(deriveConversationTitle('   selam   naparsın  '), 'selam naparsın');
  assert.equal(deriveConversationTitle(''), 'Yeni Sohbet');
  assert.equal(deriveConversationTitle('a'.repeat(60)).length, 44);
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
    body: JSON.stringify({ messages: [], model: 'helyume-void' }),
  });
  const emptyMsgsRes = await chatPost(emptyMsgsReq);
  assert.equal(emptyMsgsRes.status, 400);
  const emptyMsgsData = (await emptyMsgsRes.json()) as { error: string };
  assert.match(emptyMsgsData.error, /mesaj/);
});
