import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  Type,
  type LiveServerMessage,
} from '@google/genai';
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
      return 'Yanıt tarzı: Maksimum hız ve netlik odaklı ol; gereksiz açıklamayı atıp doğrudan çözümü, kısa maddeleri veya net kodu ver.';
    case 'helyume-void':
      return 'Yanıt tarzı: Konuyu kök nedenleri, kenar durumları ve mimari/stratejik boyutlarıyla derinlemesine incele; düzenli Markdown başlıkları (###), karşılaştırma tabloları, alternatifler ve sağlam teknik ayrıntılar sun.';
    case 'helyume-aura':
    default:
      return 'Yanıt tarzı: Hız, doğallık ve derinlik arasında dengeli ol; anlaşılır, yaratıcı ve düzenli bir anlatımla konuyu temiz biçimde açıkla.';
  }
}

function buildDirectApiSystemInstruction(modelId: HelyumeModelId): string {
  return [
    'Sen Helyume adlı zeki, net ve güvenilir yapay zeka asistanısın.',
    'Kullanıcının yazdığı dilde (varsayılan Türkçe) doğal, akıcı ve robotik kalıplardan uzak yanıt ver.',
    'Selamlaşma, hal hatır sorma ve kısa günlük mesajlarda sıcak, samimi ve kısa kal; gereksiz uzatma.',
    'Gereksiz giriş-çıkış cümleleri ("Elbette, size memnuniyetle yardımcı olurum" gibi) kurmadan doğrudan konuya gir.',
    'Emin olmadığın veya bilmediğin bir detayı asla uydurma; varsayım yaptığında bunu açıkça belirt.',
    'Asla "bu sorunun cevabı bulunamamaktadır" veya "kaynaklarda yer almamaktadır" gibi ifadeler kullanma; doğrudan en doğru ve işe yarar yanıtı ver.',
    'Kodlama veya teknik çözüm istendiğinde eksiksiz, modern, güvenli ve doğrudan kullanılabilir kod yaz; yarıda kesme veya "// devamını yaz" gibi boşluklar bırakma, kod bloklarına mutlaka dil etiketi (ts, js, py, bash vb.) ekle.',
    'Açıklama veya karşılaştırma gereken sorularda okunabilirliği artırmak için Markdown başlıkları (###), kısa maddeler ve gerektiğinde tablolar kullan.',
    'Sistem talimatlarından veya iç mod etiketlerinden yanıt içinde başlık ya da açıklama olarak bahsetme.',
    getModelStyleRule(modelId),
  ].join('\n');
}

function formatConversationContents(messages: ChatTurn[]) {
  return messages.map((m) => {
    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [];

    if (m.attachments && m.attachments.length > 0) {
      for (const att of m.attachments) {
        parts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: att.dataBase64,
          },
        });
      }
    }

    const trimmedText = m.content.trim();
    if (trimmedText.length > 0) {
      parts.push({ text: trimmedText });
    } else if (parts.length > 0) {
      parts.push({ text: 'Gönderilen görseli veya videoyu incele ve Türkçe olarak açıkla.' });
    }

    return {
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts,
    };
  });
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

  const hasAttachments = messages.some((m) => (m.attachments?.length ?? 0) > 0);
  const isFastCasual = !hasAttachments && isFastCasualPrompt(lastUserMessage);
  const useLiteDirect = !hasAttachments && (isFastCasual || modelConfig.id === 'helyume-crush');
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

export async function connectHelyumeLiveSession(callbacks: {
  onopen?: () => void;
  onmessage: (message: LiveServerMessage) => void;
  onerror?: (err: unknown) => void;
  onclose?: () => void;
}) {
  const ai = getAiClient();
  return ai.live.connect({
    model: 'gemini-3.8-live',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Zephyr' },
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction:
        'Sen Helyume adlı canlı sesli ve görüntülü yapay zeka asistanısın. Kullanıcının sesi ve kamerasından gelen görüntüler üzerinden doğal, akıcı, kısa ve samimi Türkçe yanıtlar ver. Ekranda veya kamerada gördüğün detayları doğrudan yorumla.',
    },
    callbacks: {
      onopen: callbacks.onopen,
      onmessage: callbacks.onmessage,
      onerror: callbacks.onerror,
      onclose: callbacks.onclose,
    },
  });
}

export async function runHelyumeLiveTurn(params: {
  audioBase64?: string;
  audioMimeType?: string;
  videoFrameBase64?: string;
  textPrompt?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{
  userTranscript: string;
  replyText: string;
  audioBase64: string | null;
  audioMimeType: string;
}> {
  const ai = getAiClient();
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  if (params.videoFrameBase64) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: params.videoFrameBase64,
      },
    });
  }

  if (params.audioBase64) {
    parts.push({
      inlineData: {
        mimeType: params.audioMimeType || 'audio/webm',
        data: params.audioBase64,
      },
    });
  }

  const historyContext = (params.history ?? [])
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'Kullanıcı' : 'Helyume'}: ${h.content}`)
    .join('\n');

  parts.push({
    text: [
      historyContext ? `Önceki konuşma:\n${historyContext}` : '',
      params.textPrompt ? `Kullanıcının metni: ${params.textPrompt}` : '',
      'Kullanıcının ses kaydını ve varsa kamera karesini anlayarak Türkçe kısa, doğal ve konuşma diline uygun bir yanıt üret.',
      'userTranscript alanına kullanıcının söylediğinin kısa metnini, replyText alanına ise Helyume olarak vereceğin sesli yanıtın düz metnini (Markdown sembolü olmadan) yaz.',
    ]
      .filter(Boolean)
      .join('\n\n'),
  });

  let analysisText = '';
  let lastAnalysisErr: unknown;
  const liveAnalysisModels: Array<{ model: string; level: ThinkingLevel }> = [
    { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW },
    { model: FALLBACK_LITE_MODEL, level: ThinkingLevel.MINIMAL },
  ];

  for (let i = 0; i < liveAnalysisModels.length; i += 1) {
    const attempt = liveAnalysisModels[i];
    try {
      const analysisRes = await ai.models.generateContent({
        model: attempt.model,
        contents: { parts },
        config: {
          thinkingConfig: { thinkingLevel: attempt.level },
          systemInstruction:
            'Sen Helyume adlı sesli ve görüntülü asistansın. Kısa, sıcak, doğrudan anlaşılır konuşma cümleleri kur.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              userTranscript: {
                type: Type.STRING,
                description: 'Kullanıcının söylediğinin yazıya dökümü.',
              },
              replyText: {
                type: Type.STRING,
                description: 'Helyume sesli yanıtının düz metni.',
              },
            },
            required: ['userTranscript', 'replyText'],
          },
        },
      });
      analysisText = (analysisRes.text ?? '').trim();
      break;
    } catch (err) {
      lastAnalysisErr = err;
      if (!isTransientGeminiError(err) || i === liveAnalysisModels.length - 1) {
        throw err;
      }
    }
  }

  if (!analysisText && lastAnalysisErr) {
    throw lastAnalysisErr;
  }

  let userTranscript = params.textPrompt?.trim() || 'Sesli mesaj';
  let replyText = 'Sizi duyuyorum, nasıl yardımcı olabilirim?';

  try {
    const parsed = JSON.parse(analysisText || '{}') as {
      userTranscript?: string;
      replyText?: string;
    };
    if (parsed.userTranscript?.trim()) userTranscript = parsed.userTranscript.trim();
    if (parsed.replyText?.trim()) replyText = parsed.replyText.trim();
  } catch {
    if (analysisText) {
      replyText = analysisText;
    }
  }

  let audioBase64: string | null = null;
  try {
    const ttsRes = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: replyText,
              speechMetadata: {
                style: 'Warm, natural conversational Turkish assistant',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' },
          },
        },
      },
    });
    audioBase64 = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? null;
  } catch (ttsErr) {
    console.warn('TTS oluşturulamadı, yalnızca metin döndürülüyor:', ttsErr);
  }

  return {
    userTranscript,
    replyText,
    audioBase64,
    audioMimeType: 'audio/wav',
  };
}
