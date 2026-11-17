import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHelyumeModel } from './src/lib/models.ts';
import { formatFriendlyApiError, type ChatTurn, type SseEvent } from './src/lib/research.ts';
import { runHelyumeResearchStream } from './server/gemini.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

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

    const validMessages: ChatTurn[] = body.messages
      .filter(
        (m): m is ChatTurn =>
          Boolean(m) &&
          typeof m === 'object' &&
          ((m as ChatTurn).role === 'user' || (m as ChatTurn).role === 'assistant') &&
          typeof (m as ChatTurn).content === 'string' &&
          (m as ChatTurn).content.trim().length > 0
      )
      .slice(-16);

    if (validMessages.length === 0) {
      res.status(400).json({ error: 'Geçerli bir mesaj içeriği bulunamadı.' });
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Helyume server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Helyume server:', err);
  process.exit(1);
});
