import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { resolveHelyumeModel, type HelyumeModelId } from '../src/lib/models.ts';
import {
  WIKI_NOT_SUFFICIENT_TOKEN,
  buildExtractiveWikipediaSummary,
  evaluateStreamPrefix,
  extractGoogleSources,
  formatFriendlyApiError,
  hasRelevantWikipediaMatch,
  isTransientGeminiError,
  isUncertainReply,
  type ChatTurn,
  type ResearchSource,
  type SseEvent,
} from '../src/lib/research.ts';
import { searchWikipedia } from './wikipedia.ts';

const FALLBACK_LITE_MODEL = 'gemini-3.1-flash-lite';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY tanımlı değil. Lütfen Settings > Secrets panelinden API anahtarınızı kontrol edin.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildGoogleSystemInstruction(modelId: HelyumeModelId): string {
  const styleRule =
    modelId === 'helyume-1-ultra'
      ? 'Yanıtları çok hızlı, net, öz ve yüksek bilgi yoğunluğuyla üret. Kısa bir giriş ve maddeli kilit bulgular kullan.'
      : 'Yanıtları kapsamlı, iyi yapılandırılmış başlıklar (###) ve net özet maddeleriyle analitik biçimde üret.';

  return [
    'Sen Helyume adlı akıllı araştırma ve özetleme asistanısın.',
    'Kullanıcının sorusunu yanıtlamak için mutlaka googleSearch aracını kullanarak güncel ve doğrulanabilir bilgi ara.',
    'Bulduğun sonuçları kullanıcıya açık, akıcı ve doğru şekilde özetleyerek yaz. Kullanıcının yazdığı dilde (genellikle Türkçe) yanıt ver.',
    styleRule,
    'ÖNEMLİ KURAL: Eğer konu Google aramasında bulunamıyorsa, güvenilir hiçbir web sonucu çıkmıyorsa veya anlamsız/uydurma/bulunamayan bir terimse, başka hiçbir metin eklemeden yalnızca tam olarak [GOOGLE_NOT_FOUND] yaz.',
  ].join('\n');
}

function buildWikipediaSystemInstruction(modelId: HelyumeModelId): string {
  const styleRule =
    modelId === 'helyume-1-ultra'
      ? 'Çok hızlı, doğrudan ve net bir özet sun.'
      : 'Düzenli alt başlıklar ve temel çıkarımlarla kapsamlı bir özet sun.';

  return [
    'Sen Helyume yapay zeka asistanısın.',
    'Sana verilen Wikipedia makale özetlerini incele ve kullanıcının sorusunu doğrudan yanıtlayıp yanıtlamadığına bak.',
    'Eğer verilen Wikipedia metinleri soruyu doğrudan cevaplıyorsa akıcı Türkçe ile özetle.',
    'ÖNEMLİ KURAL: Eğer verilen Wikipedia metinleri kullanıcının sorusunu yanıtlamak için yetersizse, konuyla ilgisizse veya sorunun cevabı metinlerde yoksa, "bulunmamaktadır" / "yer almıyor" GİBİ BİR CÜMLE YAZMA; bunun yerine yalnızca tam olarak [WIKI_NOT_SUFFICIENT] yaz.',
    styleRule,
  ].join('\n');
}

function buildDirectApiSystemInstruction(modelId: HelyumeModelId): string {
  const styleRule =
    modelId === 'helyume-1-ultra'
      ? 'Yanıtları çok hızlı, net ve öz biçimde üret.'
      : 'Yanıtları düzenli başlıklar, açıklayıcı maddeler ve kapsamlı bir analizle üret.';

  return [
    'Sen Helyume adlı yapay zeka asistanısın.',
    'Kullanıcının sorusunu kendi bilgi birikimin ve akıl yürütmenle doğrudan, eksiksiz ve yardımcı olacak şekilde yanıtla.',
    'Asla "bu sorunun cevabı bulunamamaktadır" veya "kaynaklarda yer almamaktadır" gibi ifadeler kullanma; doğrudan en iyi ve doğru yanıtı ver.',
    'Kullanıcının dilinde (genellikle Türkçe) yanıt üret.',
    styleRule,
  ].join('\n');
}

function formatConversationContents(messages: ChatTurn[]) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }));
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function streamTextWithRetryAndFallback(params: {
  ai: GoogleGenAI;
  primaryModel: string;
  thinkingLevel: ThinkingLevel;
  contents: ReturnType<typeof formatConversationContents>;
  systemInstruction: string;
  onDelta: (text: string) => void;
  signal: AbortSignal;
}): Promise<void> {
  const {
    ai,
    primaryModel,
    thinkingLevel,
    contents,
    systemInstruction,
    onDelta,
    signal,
  } = params;

  const attempts: Array<{ model: string; level: ThinkingLevel; delayMs: number }> = [
    { model: primaryModel, level: thinkingLevel, delayMs: 0 },
    { model: primaryModel, level: thinkingLevel, delayMs: 450 },
    { model: FALLBACK_LITE_MODEL, level: ThinkingLevel.LOW, delayMs: 300 },
  ];

  let lastError: unknown;

  for (let i = 0; i < attempts.length; i += 1) {
    if (signal.aborted) return;
    const attempt = attempts[i];
    if (attempt.delayMs > 0) {
      await sleepAbortable(attempt.delayMs, signal);
      if (signal.aborted) return;
    }

    let emittedAny = false;
    try {
      const stream = await ai.models.generateContentStream({
        model: attempt.model,
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: attempt.level },
        },
      });

      for await (const chunk of stream) {
        if (signal.aborted) return;
        const text = chunk.text ?? '';
        if (text) {
          emittedAny = true;
          onDelta(text);
        }
      }
      return;
    } catch (err) {
      if (signal.aborted) return;
      lastError = err;
      if (emittedAny || !isTransientGeminiError(err) || i === attempts.length - 1) {
        throw new Error(formatFriendlyApiError(err));
      }
    }
  }

  throw new Error(formatFriendlyApiError(lastError));
}

export async function runHelyumeResearchStream(params: {
  messages: ChatTurn[];
  modelId: HelyumeModelId;
  emit: (event: SseEvent) => void;
  signal: AbortSignal;
}): Promise<void> {
  const { messages, modelId, emit, signal } = params;
  const startedAt = Date.now();
  const modelConfig = resolveHelyumeModel(modelId);
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  emit({
    type: 'status',
    phase: 'google',
    label: "Google'da Araştırılıyor...",
  });

  const ai = getAiClient();
  const thinkingLevel =
    modelId === 'helyume-1-ultra' ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM;

  let notFoundTriggered = false;
  let googleFailed = false;
  let streamedAnyGoogleText = false;
  let fullGoogleText = '';
  let prefixBuffer = '';
  let prefixResolved = false;
  const googleSourcesMap = new Map<string, ResearchSource>();

  try {
    const stream = await ai.models.generateContentStream({
      model: modelConfig.backendModel,
      contents: formatConversationContents(messages),
      config: {
        systemInstruction: buildGoogleSystemInstruction(modelId),
        thinkingConfig: { thinkingLevel },
        tools: [{ googleSearch: {} }],
      },
    });

    for await (const chunk of stream) {
      if (signal.aborted) return;

      const meta = chunk.candidates?.[0]?.groundingMetadata;
      for (const src of extractGoogleSources(meta)) {
        if (!googleSourcesMap.has(src.url)) {
          googleSourcesMap.set(src.url, src);
        }
      }

      const delta = chunk.text ?? '';
      if (!delta) continue;

      if (!prefixResolved) {
        prefixBuffer += delta;
        const decision = evaluateStreamPrefix(prefixBuffer);
        if (decision.action === 'hold') {
          continue;
        }
        if (decision.action === 'not_found') {
          notFoundTriggered = true;
          break;
        }
        prefixResolved = true;
        fullGoogleText += decision.text;
        streamedAnyGoogleText = true;
        emit({ type: 'delta', text: decision.text });
        prefixBuffer = '';
      } else {
        fullGoogleText += delta;
        streamedAnyGoogleText = true;
        emit({ type: 'delta', text: delta });
      }
    }

    if (!prefixResolved && !notFoundTriggered && prefixBuffer.trim().length > 0) {
      const finalDecision = evaluateStreamPrefix(prefixBuffer);
      if (finalDecision.action === 'not_found') {
        notFoundTriggered = true;
      } else if (finalDecision.action === 'stream') {
        fullGoogleText += finalDecision.text;
        streamedAnyGoogleText = true;
        emit({ type: 'delta', text: finalDecision.text });
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('API_KEY_INVALID') ||
      msg.includes('PERMISSION_DENIED') ||
      msg.includes('403')
    ) {
      throw new Error(formatFriendlyApiError(err));
    }
    googleFailed = true;
  }

  if (signal.aborted) return;

  const googleSources = Array.from(googleSourcesMap.values());
  const needsWikipedia =
    notFoundTriggered ||
    googleFailed ||
    !streamedAnyGoogleText ||
    (googleSources.length === 0 && isUncertainReply(fullGoogleText));

  if (!needsWikipedia) {
    if (googleSources.length > 0) {
      emit({ type: 'sources', engine: 'google', sources: googleSources });
    }
    emit({
      type: 'done',
      engine: 'google',
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  emit({
    type: 'status',
    phase: 'wikipedia',
    label: "Wikipedia'da Araştırılıyor...",
  });

  const articles = await searchWikipedia(lastUserMessage);
  if (signal.aborted) return;

  if (articles.length === 0) {
    emit({
      type: 'status',
      phase: 'thinking',
      label: 'Bir Süre Düşünüyor...',
    });

    await streamTextWithRetryAndFallback({
      ai,
      primaryModel: modelConfig.backendModel,
      thinkingLevel: ThinkingLevel.LOW,
      contents: formatConversationContents(messages),
      systemInstruction: buildDirectApiSystemInstruction(modelId),
      onDelta: (text) => emit({ type: 'delta', text }),
      signal,
    });

    if (signal.aborted) return;
    emit({
      type: 'done',
      engine: 'api',
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  const wikiSources: ResearchSource[] = articles.map((a) => ({
    title: `${a.title} (Wikipedia ${a.lang.toUpperCase()})`,
    url: a.url,
    engine: 'wikipedia',
    snippet: a.extract.slice(0, 180),
  }));

  const wikiContext = articles
    .map(
      (a, idx) =>
        `[${idx + 1}] Başlık: ${a.title} (${a.lang.toUpperCase()})\nURL: ${a.url}\nÖzet: ${a.extract}`
    )
    .join('\n\n');

  let streamedWiki = false;
  let wikiNotSufficient = false;
  let wikiPrefixBuffer = '';
  let wikiPrefixResolved = false;
  let fullWikiText = '';

  try {
    await streamTextWithRetryAndFallback({
      ai,
      primaryModel: modelConfig.backendModel,
      thinkingLevel: ThinkingLevel.LOW,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Kullanıcı Sorusu: ${lastUserMessage}\n\nWikipedia Araştırma Sonuçları:\n${wikiContext}\n\nYukarıdaki Wikipedia sonuçları soruyu doğrudan yanıtlıyorsa özetle; yetersizse yalnızca [WIKI_NOT_SUFFICIENT] yaz.`,
            },
          ],
        },
      ],
      systemInstruction: buildWikipediaSystemInstruction(modelId),
      onDelta: (delta) => {
        if (wikiNotSufficient) return;
        if (!wikiPrefixResolved) {
          wikiPrefixBuffer += delta;
          const decision = evaluateStreamPrefix(
            wikiPrefixBuffer,
            WIKI_NOT_SUFFICIENT_TOKEN
          );
          if (decision.action === 'hold') {
            return;
          }
          if (decision.action === 'not_found') {
            wikiNotSufficient = true;
            return;
          }
          wikiPrefixResolved = true;
          streamedWiki = true;
          fullWikiText += decision.text;
          emit({ type: 'delta', text: decision.text });
          wikiPrefixBuffer = '';
        } else {
          streamedWiki = true;
          fullWikiText += delta;
          emit({ type: 'delta', text: delta });
        }
      },
      signal,
    });

    if (!wikiPrefixResolved && !wikiNotSufficient && wikiPrefixBuffer.trim().length > 0) {
      const finalDecision = evaluateStreamPrefix(
        wikiPrefixBuffer,
        WIKI_NOT_SUFFICIENT_TOKEN
      );
      if (finalDecision.action === 'not_found') {
        wikiNotSufficient = true;
      } else if (finalDecision.action === 'stream') {
        streamedWiki = true;
        fullWikiText += finalDecision.text;
        emit({ type: 'delta', text: finalDecision.text });
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    if (!streamedWiki && hasRelevantWikipediaMatch(lastUserMessage, articles)) {
      const extractive = buildExtractiveWikipediaSummary(articles);
      if (extractive) {
        emit({ type: 'sources', engine: 'wikipedia', sources: wikiSources });
        emit({ type: 'delta', text: extractive });
        emit({
          type: 'done',
          engine: 'wikipedia',
          durationMs: Date.now() - startedAt,
        });
        return;
      }
    }
    throw err;
  }

  if (signal.aborted) return;

  if (wikiNotSufficient || !streamedWiki || isUncertainReply(fullWikiText)) {
    emit({
      type: 'status',
      phase: 'thinking',
      label: 'Bir Süre Düşünüyor...',
    });

    await streamTextWithRetryAndFallback({
      ai,
      primaryModel: modelConfig.backendModel,
      thinkingLevel: ThinkingLevel.LOW,
      contents: formatConversationContents(messages),
      systemInstruction: buildDirectApiSystemInstruction(modelId),
      onDelta: (text) => emit({ type: 'delta', text }),
      signal,
    });

    if (signal.aborted) return;
    emit({
      type: 'done',
      engine: 'api',
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  emit({ type: 'sources', engine: 'wikipedia', sources: wikiSources });
  emit({
    type: 'done',
    engine: 'wikipedia',
    durationMs: Date.now() - startedAt,
  });
}
