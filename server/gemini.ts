import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { resolveHelyumeModel, type HelyumeModelId } from '../src/lib/models.ts';
import {
  formatFriendlyApiError,
  isFastCasualPrompt,
  isTransientGeminiError,
  type ChatTurn,
  type SseEvent,
} from '../src/lib/research.ts';

const FALLBACK_LITE_MODEL = 'gemini-3.1-flash-lite';

const FIRST_TOKEN_TIMEOUT_MS = 2800;
const FALLBACK_TIMEOUT_MS = 8000;

let cachedClient: { apiKey: string; ai: GoogleGenAI } | null = null;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY tanımlı değil. Lütfen sunucu ortam değişkenlerini kontrol edin.'
    );
  }
  if (cachedClient && cachedClient.apiKey === apiKey) {
    return cachedClient.ai;
  }
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 25000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  cachedClient = { apiKey, ai };
  return ai;
}

function getModelStyleRule(modelId: HelyumeModelId): string {
  switch (modelId) {
    case 'helyume-crush':
      return 'Helyume Crush modundasın: Gereksiz uzatmadan doğrudan öze in, net maddeler kullan, pratik ve enerjik bir dille yüksek hızda çözüm sun.';
    case 'helyume-void':
      return 'Helyume Void modundasın: Konuyu derinlemesine ve çok boyutlu ele al; düzenli başlıklar (###), net karşılaştırma/tablolar, teknik doğruluk ve stratejik ayrıntılarla kapsamlı yanıt üret.';
    case 'helyume-aura':
    default:
      return 'Helyume Aura modundasın: Akıcı, dengeli ve yaratıcı bir anlatım kullan; gerektiğinde düzenli başlıklar (###) ve anlaşılır maddelerle net bir yapı kur.';
  }
}

function buildDirectApiSystemInstruction(modelId: HelyumeModelId): string {
  return [
    'Sen Helyume adlı samimi, zeki ve hızlı yapay zeka asistanısın.',
    'Selamlaşma, hal hatır sorma ve günlük sohbetlerde kısa, doğal ve sıcak bir dille yanıt ver.',
    'Bilgi, planlama, analiz veya teknik sorularda kendi bilgi birikimin ve akıl yürütmenle doğrudan, eksiksiz ve yardımcı olacak şekilde yanıtla.',
    'Asla "bu sorunun cevabı bulunamamaktadır" veya "kaynaklarda yer almamaktadır" gibi ifadeler kullanma; doğrudan en iyi ve doğru yanıtı ver.',
    'Kullanıcının dilinde (genellikle Türkçe) yanıt üret.',
    getModelStyleRule(modelId),
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

  const attempts: Array<{
    model: string;
    level: ThinkingLevel;
    delayMs: number;
    firstTokenMs: number;
  }> = [
    {
      model: primaryModel,
      level: thinkingLevel,
      delayMs: 0,
      firstTokenMs: FIRST_TOKEN_TIMEOUT_MS,
    },
    {
      model: FALLBACK_LITE_MODEL,
      level: ThinkingLevel.MINIMAL,
      delayMs: 0,
      firstTokenMs: FALLBACK_TIMEOUT_MS,
    },
    {
      model: primaryModel,
      level: ThinkingLevel.LOW,
      delayMs: 150,
      firstTokenMs: FALLBACK_TIMEOUT_MS,
    },
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
    let firstTokenTimedOut = false;
    const attemptController = new AbortController();
    const onParentAbort = () => attemptController.abort();
    signal.addEventListener('abort', onParentAbort, { once: true });

    const firstTokenTimer = setTimeout(() => {
      if (!emittedAny) {
        firstTokenTimedOut = true;
        attemptController.abort();
      }
    }, attempt.firstTokenMs);

    try {
      const stream = await ai.models.generateContentStream({
        model: attempt.model,
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: attempt.level },
          abortSignal: attemptController.signal,
        },
      });

      for await (const chunk of stream) {
        if (signal.aborted) return;
        const text = chunk.text ?? '';
        if (text) {
          if (!emittedAny) {
            emittedAny = true;
            clearTimeout(firstTokenTimer);
          }
          onDelta(text);
        }
      }
      clearTimeout(firstTokenTimer);
      return;
    } catch (err) {
      clearTimeout(firstTokenTimer);
      if (signal.aborted) return;
      lastError = firstTokenTimedOut
        ? new Error('DEADLINE_EXCEEDED: Model yanıtı zaman aşımına uğradı.')
        : err;
      const canFailover =
        !emittedAny &&
        (firstTokenTimedOut || isTransientGeminiError(err)) &&
        i < attempts.length - 1;
      if (!canFailover) {
        throw new Error(formatFriendlyApiError(lastError));
      }
    } finally {
      signal.removeEventListener('abort', onParentAbort);
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

  const ai = getAiClient();

  emit({
    type: 'status',
    phase: 'thinking',
    label: 'Düşünüyor...',
  });

  const isFastCasual = isFastCasualPrompt(lastUserMessage);
  const useLiteDirect = isFastCasual || modelConfig.id === 'helyume-crush';
  const primaryThinking = useLiteDirect
    ? ThinkingLevel.MINIMAL
    : modelConfig.id === 'helyume-void'
      ? ThinkingLevel.MEDIUM
      : ThinkingLevel.LOW;

  await streamTextWithRetryAndFallback({
    ai,
    primaryModel: useLiteDirect ? FALLBACK_LITE_MODEL : modelConfig.backendModel,
    thinkingLevel: primaryThinking,
    contents: formatConversationContents(messages),
    systemInstruction: buildDirectApiSystemInstruction(modelConfig.id),
    onDelta: (text) => emit({ type: 'delta', text }),
    signal,
  });

  if (signal.aborted) return;
  emit({
    type: 'done',
    engine: 'api',
    durationMs: Date.now() - startedAt,
  });
}
