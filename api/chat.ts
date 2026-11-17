import { resolveHelyumeModel } from '../src/lib/models.ts';
import {
  formatFriendlyApiError,
  sanitizeChatTurns,
  type SseEvent,
} from '../src/lib/research.ts';
import { runHelyumeResearchStream } from '../server/gemini.ts';

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  let body: { messages?: unknown; model?: string } | null = null;
  try {
    body = (await request.json()) as { messages?: unknown; model?: string };
  } catch {
    return Response.json(
      { error: 'Geçersiz JSON istek gövdesi.' },
      { status: 400 }
    );
  }

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return Response.json(
      { error: 'En az bir mesaj göndermelisiniz.' },
      { status: 400 }
    );
  }

  const validMessages = sanitizeChatTurns(body.messages);

  if (validMessages.length === 0) {
    return Response.json(
      { error: 'Geçerli bir mesaj veya medya içeriği bulunamadı.' },
      { status: 400 }
    );
  }

  const modelConfig = resolveHelyumeModel(body.model);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const emit = (event: SseEvent) => {
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await runHelyumeResearchStream({
          messages: validMessages,
          modelId: modelConfig.id,
          emit,
          signal: request.signal,
        });
      } catch (error) {
        if (!request.signal.aborted) {
          emit({ type: 'error', message: formatFriendlyApiError(error) });
        }
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Stream already closed
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
