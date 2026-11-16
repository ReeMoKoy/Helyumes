import { ArrowUpRight, Menu, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Composer } from './components/Composer';
import { HelyumeLogo } from './components/HelyumeLogo';
import { MessageList } from './components/MessageList';
import { EmptyStateModelCards, TopBarModelSelector } from './components/ModelSelector';
import { Sidebar } from './components/Sidebar';
import { DEFAULT_HELYUME_MODEL, type HelyumeModelId } from './lib/models';
import { formatFriendlyApiError, parseSseChunk, type ChatTurn } from './lib/research';
import {
  deriveConversationTitle,
  loadConversations,
  saveConversations,
  type ChatMessage,
  type Conversation,
} from './lib/storage';

const STARTER_PROMPTS = [
  'Kuantum bilgisayar nasıl çalışır ve klasik bilgisayarlardan farkı nedir?',
  'Göbeklitepe hakkında arkeolojik bulguları özetle',
  'James Webb Uzay Teleskobu ile yapılan son keşifler nelerdir?',
  'Yapay zeka tarihinde dönüm noktaları nelerdir?',
];

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const initial = loadConversations();
    return initial[0]?.id ?? null;
  });
  const [selectedModel, setSelectedModel] = useState<HelyumeModelId>(DEFAULT_HELYUME_MODEL);
  const [input, setInput] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    if (activeConversation) {
      setSelectedModel(activeConversation.model);
    }
  }, [activeConversation?.id]);

  const scrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeConversation?.messages.length, streamingConvId]);

  const handleModelChange = (modelId: HelyumeModelId) => {
    setSelectedModel(modelId);
    if (activeId) {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeId ? { ...c, model: modelId } : c))
      );
    }
  };

  const handleNewChat = () => {
    if (streamingConvId) {
      abortRef.current?.abort();
      setStreamingConvId(null);
    }
    setActiveId(null);
    setInput('');
  };

  const handleSelectChat = (id: string) => {
    if (streamingConvId && streamingConvId !== id) {
      abortRef.current?.abort();
      setStreamingConvId(null);
    }
    setActiveId(id);
  };

  const handleDeleteChat = (id: string) => {
    if (streamingConvId === id) {
      abortRef.current?.abort();
      setStreamingConvId(null);
    }
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleStop = () => {
    abortRef.current?.abort();
    if (!streamingConvId) return;
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== streamingConvId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.phase === 'google' ||
            m.phase === 'wikipedia' ||
            m.phase === 'thinking' ||
            m.phase === 'streaming'
              ? { ...m, phase: 'done' as const }
              : m
          ),
        };
      })
    );
    setStreamingConvId(null);
  };

  const updateAssistantMessage = (
    convId: string,
    assistantId: string,
    updater: (msg: ChatMessage) => ChatMessage
  ) => {
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== convId) return conv;
        return {
          ...conv,
          updatedAt: Date.now(),
          messages: conv.messages.map((m) => (m.id === assistantId ? updater(m) : m)),
        };
      })
    );
  };

  const streamToAssistant = async (
    targetConvId: string,
    assistantId: string,
    historyTurns: ChatTurn[],
    modelToUse: HelyumeModelId
  ) => {
    setStreamingConvId(targetConvId);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: historyTurns,
          model: modelToUse,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errPayload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errPayload?.error || `Sunucu hatası (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let carry = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const textChunk = decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(textChunk, carry);
        carry = parsed.carry;

        for (const ev of parsed.events) {
          if (ev.type === 'status') {
            updateAssistantMessage(targetConvId, assistantId, (msg) => ({
              ...msg,
              phase: ev.phase,
              statusLabel: ev.label,
              error: undefined,
              content:
                ev.phase === 'wikipedia' || ev.phase === 'thinking' ? '' : msg.content,
            }));
          } else if (ev.type === 'delta') {
            updateAssistantMessage(targetConvId, assistantId, (msg) => ({
              ...msg,
              phase: 'streaming',
              content: msg.content + ev.text,
            }));
            scrollToBottom();
          } else if (ev.type === 'sources') {
            updateAssistantMessage(targetConvId, assistantId, (msg) => ({
              ...msg,
              engine: ev.engine,
              sources: ev.sources,
            }));
          } else if (ev.type === 'done') {
            updateAssistantMessage(targetConvId, assistantId, (msg) => ({
              ...msg,
              phase: 'done',
              engine: msg.engine ?? ev.engine,
              durationMs: ev.durationMs,
            }));
          } else if (ev.type === 'error') {
            updateAssistantMessage(targetConvId, assistantId, (msg) => ({
              ...msg,
              phase: 'error',
              error: formatFriendlyApiError(ev.message),
            }));
          }
        }
      }

      updateAssistantMessage(targetConvId, assistantId, (msg) =>
        msg.phase === 'done' || msg.phase === 'error' ? msg : { ...msg, phase: 'done' }
      );
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        return;
      }
      updateAssistantMessage(targetConvId, assistantId, (msg) => ({
        ...msg,
        phase: 'error',
        error: formatFriendlyApiError(error),
      }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setStreamingConvId(null);
    }
  };

  const runPrompt = async (promptText: string, overrideConvId?: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || streamingConvId) return;

    const targetConvId = overrideConvId ?? activeId ?? createId('conv');
    const userMsg: ChatMessage = {
      id: createId('msg'),
      role: 'user',
      content: trimmed,
    };
    const assistantId = createId('msg');
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      model: selectedModel,
      phase: 'google',
      statusLabel: "Google'da Araştırılıyor...",
    };

    const existingConv = conversations.find((c) => c.id === targetConvId);
    const historyTurns: ChatTurn[] = [
      ...(existingConv?.messages ?? [])
        .filter((m) => m.content.trim().length > 0 && !m.error)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: trimmed },
    ];

    if (existingConv) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === targetConvId
            ? {
                ...c,
                model: selectedModel,
                updatedAt: Date.now(),
                messages: [...c.messages, userMsg, assistantPlaceholder],
              }
            : c
        )
      );
    } else {
      const newConv: Conversation = {
        id: targetConvId,
        title: deriveConversationTitle(trimmed),
        model: selectedModel,
        updatedAt: Date.now(),
        messages: [userMsg, assistantPlaceholder],
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveId(targetConvId);
    }

    setInput('');
    await streamToAssistant(targetConvId, assistantId, historyTurns, selectedModel);
  };

  const handleRetryMessage = (failedAssistantId: string) => {
    if (!activeConversation || streamingConvId) return;
    const idx = activeConversation.messages.findIndex((m) => m.id === failedAssistantId);
    if (idx === -1) return;

    const priorMessages = activeConversation.messages.slice(0, idx);
    const historyTurns: ChatTurn[] = priorMessages
      .filter((m) => m.content.trim().length > 0 && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    if (!historyTurns.some((t) => t.role === 'user')) return;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversation.id
          ? {
              ...c,
              model: selectedModel,
              updatedAt: Date.now(),
              messages: c.messages.map((m) =>
                m.id === failedAssistantId
                  ? {
                      ...m,
                      content: '',
                      error: undefined,
                      sources: undefined,
                      durationMs: undefined,
                      engine: undefined,
                      model: selectedModel,
                      phase: 'google' as const,
                      statusLabel: "Google'da Araştırılıyor...",
                    }
                  : m
              ),
            }
          : c
      )
    );

    void streamToAssistant(
      activeConversation.id,
      failedAssistantId,
      historyTurns,
      selectedModel
    );
  };

  const isStreaming = streamingConvId !== null;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#07090e] text-slate-100">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
      />

      <div className="relative flex flex-1 min-w-0 flex-col h-full">
        <header className="flex items-center justify-between gap-4 px-4 sm:px-6 h-14 shrink-0 border-b border-white/[0.07] bg-[#07090e]/85 backdrop-blur-md z-10">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Menüyü aç"
              className="md:hidden p-2 -ml-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display text-sm sm:text-base font-semibold truncate text-white">
              {activeConversation ? activeConversation.title : 'Helyume'}
            </h1>
          </div>

          <TopBarModelSelector
            selectedModel={selectedModel}
            onSelect={handleModelChange}
            disabled={isStreaming}
          />
        </header>

        <main ref={scrollContainerRef} className="relative flex-1 overflow-y-auto">
          {!activeConversation || activeConversation.messages.length === 0 ? (
            <div className="relative mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-4 sm:px-6 py-10">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-12 left-1/2 -translate-x-1/2 h-56 w-[440px] max-w-full rounded-full bg-[radial-gradient(ellipse_at_center,rgba(56,189,248,0.12),rgba(139,92,246,0.08)_45%,transparent_75%)] blur-2xl"
              />

              <div className="relative mb-5 rounded-2xl p-[1.5px] helyume-rgb-bar shadow-[0_0_30px_-8px_rgba(56,189,248,0.35)]">
                <div className="rounded-[14px] bg-[#07090e] p-2">
                  <HelyumeLogo className="w-10 h-10" />
                </div>
              </div>

              <h2
                className="relative font-display text-2xl sm:text-4xl font-bold tracking-tight text-center text-white"
                style={{ textWrap: 'balance' }}
              >
                Ne araştırmak istersiniz?
              </h2>
              <p className="relative mt-2.5 text-sm text-center text-slate-400 max-w-lg leading-relaxed">
                Helyume sorunuzu önce Google&apos;da arar; sonuç bulamazsa Wikipedia&apos;yı
                tarar veya doğrudan düşünerek hızlıca özetler.
              </p>

              <div className="relative mt-8 w-full flex flex-col items-center">
                <p className="text-xs font-medium text-slate-400 mb-3">
                  Model Seçimi
                </p>
                <EmptyStateModelCards
                  selectedModel={selectedModel}
                  onSelect={handleModelChange}
                />
              </div>

              <div className="relative mt-7 w-full max-w-2xl">
                <p className="text-xs font-medium text-slate-400 mb-3">
                  Örnek Aramalar
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => runPrompt(prompt)}
                      className="group flex items-start justify-between gap-2.5 p-3.5 rounded-xl border border-white/[0.08] bg-[#0b0f17] text-left text-xs leading-relaxed text-slate-300 hover:border-white/[0.2] hover:bg-[#0f1520] hover:text-white transition-all"
                    >
                      <span className="flex items-start gap-2.5 min-w-0">
                        <Search className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-500 group-hover:text-sky-300 transition-colors" aria-hidden="true" />
                        <span>{prompt}</span>
                      </span>
                      <ArrowUpRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-600 group-hover:text-slate-200 transition-colors" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <MessageList messages={activeConversation.messages} onRetry={handleRetryMessage} />
          )}
        </main>

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => runPrompt(input)}
          onStop={handleStop}
          isStreaming={isStreaming}
          selectedModel={selectedModel}
        />
      </div>
    </div>
  );
}
