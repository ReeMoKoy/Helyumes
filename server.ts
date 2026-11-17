import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { LiveServerMessage } from '@google/genai';
import { resolveHelyumeModel } from './src/lib/models.ts';
import {
  formatFriendlyApiError,
  sanitizeChatTurns,
  type SseEvent,
} from './src/lib/research.ts';
import {
  connectHelyumeLiveSession,
  runHelyumeLiveTurn,
  runHelyumeResearchStream,
} from './server/gemini.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '16mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'helyume' });
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    const body = req.body as {
      messages?: unknown;
      model?: string;
    };

    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      res.status(400).json({ error: 'En az bir mesaj göndermelisiniz.' });
      return;
    }

    const validMessages = sanitizeChatTurns(body.messages);

    if (validMessages.length === 0) {
      res.status(400).json({ error: 'Geçerli bir mesaj veya medya içeriği bulunamadı.' });
      return;
    }

    const modelConfig = resolveHelyumeModel(body.model);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const emit = (event: SseEvent) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await runHelyumeResearchStream({
        messages: validMessages,
        modelId: modelConfig.id,
        emit,
        signal: abortController.signal,
      });
    } catch (error) {
      if (!abortController.signal.aborted) {
        emit({ type: 'error', message: formatFriendlyApiError(error) });
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  app.post('/api/live-turn', async (req: Request, res: Response) => {
    const body = req.body as {
      audioBase64?: string;
      audioMimeType?: string;
      videoFrameBase64?: string;
      textPrompt?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!body?.audioBase64 && !body?.videoFrameBase64 && !body?.textPrompt?.trim()) {
      res.status(400).json({ error: 'Ses, kamera karesi veya metin göndermelisiniz.' });
      return;
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
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: formatFriendlyApiError(error) });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/live') {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', async (clientWs) => {
    let closed = false;
    let session: Awaited<ReturnType<typeof connectHelyumeLiveSession>> | null = null;

    const sendSafe = (payload: Record<string, unknown>) => {
      if (closed || clientWs.readyState !== WebSocket.OPEN) return;
      clientWs.send(JSON.stringify(payload));
    };

    try {
      session = await connectHelyumeLiveSession({
        onopen: () => {
          sendSafe({ type: 'ready' });
        },
        onmessage: (message: LiveServerMessage) => {
          const content = message.serverContent;
          if (content?.inputTranscription?.text) {
            sendSafe({ type: 'inputTranscript', text: content.inputTranscription.text });
          }
          if (content?.outputTranscription?.text) {
            sendSafe({ type: 'outputTranscript', text: content.outputTranscription.text });
          }
          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              sendSafe({ type: 'audio', data: part.inlineData.data });
            }
          }
          if (content?.interrupted) {
            sendSafe({ type: 'interrupted' });
          }
          if (content?.turnComplete) {
            sendSafe({ type: 'turnComplete' });
          }
        },
        onerror: (err) => {
          sendSafe({ type: 'error', message: formatFriendlyApiError(err) });
        },
        onclose: () => {
          if (!closed) {
            sendSafe({ type: 'closed' });
          }
        },
      });
      sendSafe({ type: 'ready' });
    } catch (err) {
      sendSafe({ type: 'error', message: formatFriendlyApiError(err) });
      clientWs.close();
      return;
    }

    clientWs.on('message', (raw) => {
      if (!session || closed) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          audio?: string;
          video?: string;
          text?: string;
        };
        if (typeof msg.audio === 'string' && msg.audio.length > 0) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        }
        if (typeof msg.video === 'string' && msg.video.length > 0) {
          session.sendRealtimeInput({
            video: { data: msg.video, mimeType: 'image/jpeg' },
          });
        }
        if (typeof msg.text === 'string' && msg.text.trim().length > 0) {
          session.sendRealtimeInput({ text: msg.text.trim() });
        }
      } catch {
        // Ignore malformed websocket frame
      }
    });

    clientWs.on('close', () => {
      closed = true;
      try {
        session?.close();
      } catch {
        // Ignore close errors
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Helyume server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Helyume server:', err);
  process.exit(1);
});
