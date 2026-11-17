import { formatFriendlyApiError } from '../src/lib/research.ts';
import { runHelyumeLiveTurn } from '../server/gemini.ts';

export const maxDuration = 60;

interface LiveTurnRequestBody {
  audioBase64?: string;
  audioMimeType?: string;
  videoFrameBase64?: string;
  textPrompt?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export async function POST(request: Request): Promise<Response> {
  let body: LiveTurnRequestBody | null = null;

  try {
    body = (await request.json()) as LiveTurnRequestBody | null;
  } catch {
    return Response.json({ error: 'Geçersiz JSON istek gövdesi.' }, { status: 400 });
  }

  if (!body?.audioBase64 && !body?.videoFrameBase64 && !body?.textPrompt?.trim()) {
    return Response.json(
      { error: 'Ses, kamera karesi veya metin göndermelisiniz.' },
      { status: 400 }
    );
  }

  try {
    const result = await runHelyumeLiveTurn({
      audioBase64: typeof body.audioBase64 === 'string' ? body.audioBase64 : undefined,
      audioMimeType: typeof body.audioMimeType === 'string' ? body.audioMimeType : undefined,
      videoFrameBase64:
        typeof body.videoFrameBase64 === 'string' ? body.videoFrameBase64 : undefined,
      textPrompt: typeof body.textPrompt === 'string' ? body.textPrompt : undefined,
      history: Array.isArray(body.history) ? body.history : undefined,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: formatFriendlyApiError(error) }, { status: 500 });
  }
}
