import { LogIn, LogOut, Menu, UserPlus } from 'lucide-react';
import type { User } from 'firebase/auth';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthModal, type AuthModalMode } from './components/AuthModal';
import { Composer } from './components/Composer';
import { HelyumeLogo } from './components/HelyumeLogo';
import { MessageList } from './components/MessageList';
import { Sidebar } from './components/Sidebar';
import { DEFAULT_HELYUME_MODEL, type HelyumeModelId } from './lib/models';
import {
  deleteCloudConversation,
  fetchConversationMessages,
  persistConversationMessages,
  signOutAccount,
  subscribeAuthState,
  subscribeUserConversations,
  updateCloudConversationModel,
} from './lib/firebase';
import {
  formatFriendlyApiError,
  parseSseChunk,
  type ChatTurn,
} from './lib/research';
import {
  deriveConversationTitle,
  loadConversations,
  saveConversations,
  type ChatMessage,
  type Conversation,
} from './lib/storage';

const MIN_THINKING_DISPLAY_MS = 500;

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  // Always open on a fresh new chat on initial page load / reload
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingConvId, setLoadingConvId] = useState<string | null>(null);

  const [selectedModel, setSelectedModel] = useState<HelyumeModelId>(DEFAULT_HELYUME_MODEL);
  const [input, setInput] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const conversationsRef = useRef<Conversation[]>(conversations);
  const activeIdRef = useRef<string | null>(activeId);
  const streamingConvIdRef = useRef<string | null>(streamingConvId);
  const userRef = useRef<User | null>(user);

  conversationsRef.current = conversations;
  activeIdRef.current = activeId;
  streamingConvIdRef.current = streamingConvId;
  userRef.current = user;

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // Subscribe to Firebase Auth state
  useEffect(() => {
    const unsubscribe = subscribeAuthState((nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setConversations(loadConversations());
        setActiveId(null);
      }
    });
    return unsubscribe;
  }, []);

  // Sync Firestore conversations when authenticated; keep guest storage separate
  useEffect(() => {
    if (!user) return;
    setConversations([]);
    const unsubscribe = subscribeUserConversations(user.uid, (cloudList) => {
      setConversations((prev) => {
        const prevMap = new Map(prev.map((c) => [c.id, c]));
        const cloudIds = new Set(cloudList.map((c) => c.id));
        const merged = cloudList.map((cloudConv) => {
          const existing = prevMap.get(cloudConv.id);
          return existing
            ? {
                ...cloudConv,
                messages: existing.messages,
              }
            : cloudConv;
        });
        for (const existing of prev) {
          if (
            !cloudIds.has(existing.id) &&
            (existing.id === activeIdRef.current || existing.id === streamingConvIdRef.current)
          ) {
            merged.unshift(existing);
          }
        }
        return merged;
      });
    });
    return unsubscribe;
  }, [user?.uid]);

  // Persist guest conversations only when signed out
  useEffect(() => {
    if (authReady && !user) {
      saveConversations(conversations);
    }
  }, [conversations, user, authReady]);

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
      if (user) {
        void updateCloudConversationModel(user.uid, activeId, modelId).catch(() => {
          // Non-fatal if conversation isn't saved in Firestore yet
        });
      }
    }
  };

  const handleNewChat = () => {
    if (streamingConvId) {
      abortRef.current?.abort();
      setStreamingConvId(null);
    }
    setActiveId(null);
    setLoadingConvId(null);
    setInput('');
  };

  const handleSelectChat = async (id: string) => {
    if (streamingConvId && streamingConvId !== id) {
      abortRef.current?.abort();
      setStreamingConvId(null);
    }
    setActiveId(id);

    const currentUser = userRef.current;
    const target = conversationsRef.current.find((c) => c.id === id);
    if (currentUser && target && target.messages.length === 0) {
      setLoadingConvId(id);
      try {
        const loadedMessages = await fetchConversationMessages(currentUser.uid, id);
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, messages: loadedMessages } : c))
        );
      } finally {
        setLoadingConvId((prev) => (prev === id ? null : prev));
      }
    }
  };

  const handleDeleteChat = (id: string) => {
    if (streamingConvId === id) {
      abortRef.current?.abort();
      setStreamingConvId(null);
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
    }
    if (user) {
      void deleteCloudConversation(user.uid, id);
    }
  };

  const handleSignOut = async () => {
    if (streamingConvId) {
      abortRef.current?.abort();
      setStreamingConvId(null);
    }
    await signOutAccount();
    setActiveId(null);
    setIsMobileSidebarOpen(false);
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
            m.phase === 'thinking' || m.phase === 'streaming'
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
    modelToUse: HelyumeModelId,
    cloudContext?: {
      title: string;
      isNewConversation: boolean;
      userMessage: ChatMessage;
    }
  ) => {
    setStreamingConvId(targetConvId);
    const controller = new AbortController();
    abortRef.current = controller;
    const streamStartedAt = Date.now();
    let deltaUnlocked = false;
    let pendingDeltaText = '';
    let unlockTimer: number | null = null;
    let pendingDoneEvent: { engine: 'api' | 'none'; durationMs: number } | null = null;

    const flushPendingDelta = () => {
      if (!pendingDeltaText || controller.signal.aborted) return;
      const chunkToFlush = pendingDeltaText;
      pendingDeltaText = '';
      updateAssistantMessage(targetConvId, assistantId, (msg) => ({
        ...msg,
        phase: 'streaming',
        content: msg.content + chunkToFlush,
      }));
      scrollToBottom();
    };

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
              content: ev.phase === 'thinking' ? '' : msg.content,
            }));
          } else if (ev.type === 'delta') {
            const elapsed = Date.now() - streamStartedAt;
            if (!deltaUnlocked && elapsed < MIN_THINKING_DISPLAY_MS) {
              pendingDeltaText += ev.text;
              if (unlockTimer === null) {
                unlockTimer = window.setTimeout(() => {
                  unlockTimer = null;
                  deltaUnlocked = true;
                  flushPendingDelta();
                }, MIN_THINKING_DISPLAY_MS - elapsed);
              }
            } else {
              deltaUnlocked = true;
              if (pendingDeltaText) {
                pendingDeltaText += ev.text;
                flushPendingDelta();
              } else {
                updateAssistantMessage(targetConvId, assistantId, (msg) => ({
                  ...msg,
                  phase: 'streaming',
                  content: msg.content + ev.text,
                }));
                scrollToBottom();
              }
            }
          } else if (ev.type === 'done') {
            if (!deltaUnlocked && pendingDeltaText) {
              pendingDeltaText += '';
              pendingDoneEvent = { engine: ev.engine, durationMs: ev.durationMs };
            } else {
              updateAssistantMessage(targetConvId, assistantId, (msg) => ({
                ...msg,
                phase: 'done',
                engine: msg.engine ?? ev.engine,
                durationMs: ev.durationMs,
              }));
            }
          } else if (ev.type === 'error') {
            if (unlockTimer !== null) {
              clearTimeout(unlockTimer);
              unlockTimer = null;
            }
            pendingDeltaText = '';
            updateAssistantMessage(targetConvId, assistantId, (msg) => ({
              ...msg,
              phase: 'error',
              error: formatFriendlyApiError(ev.message),
            }));
          }
        }
      }

      if (pendingDeltaText && !controller.signal.aborted) {
        const remaining = Math.max(0, MIN_THINKING_DISPLAY_MS - (Date.now() - streamStartedAt));
        if (remaining > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, remaining));
        }
        if (!controller.signal.aborted) {
          deltaUnlocked = true;
          flushPendingDelta();
        }
      }

      if (pendingDoneEvent && !controller.signal.aborted) {
        const doneEv = pendingDoneEvent;
        updateAssistantMessage(targetConvId, assistantId, (msg) => ({
          ...msg,
          phase: 'done',
          engine: msg.engine ?? doneEv.engine,
          durationMs: doneEv.durationMs,
        }));
      }

      updateAssistantMessage(targetConvId, assistantId, (msg) =>
        msg.phase === 'done' || msg.phase === 'error' ? msg : { ...msg, phase: 'done' }
      );
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        updateAssistantMessage(targetConvId, assistantId, (msg) => ({
          ...msg,
          phase: 'error',
          error: formatFriendlyApiError(error),
        }));
      }
    } finally {
      if (unlockTimer !== null) {
        clearTimeout(unlockTimer);
        unlockTimer = null;
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setStreamingConvId(null);

      const currentUser = userRef.current;
      if (currentUser && cloudContext) {
        const latestConv = conversationsRef.current.find((c) => c.id === targetConvId);
        const latestAsst = latestConv?.messages.find((m) => m.id === assistantId);
        if (latestAsst && latestAsst.content.trim().length > 0) {
          void persistConversationMessages({
            userId: currentUser.uid,
            conversationId: targetConvId,
            title: cloudContext.title,
            model: modelToUse,
            isNewConversation: cloudContext.isNewConversation,
            userMessage: cloudContext.userMessage,
            assistantMessage: latestAsst,
          });
        }
      }
    }
  };

  const runPrompt = async (promptText: string, overrideConvId?: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || streamingConvId) return;

    const targetConvId = overrideConvId ?? activeId ?? createId('conv');
    const existingConv = conversations.find((c) => c.id === targetConvId);
    const validPriorTurns = (existingConv?.messages ?? [])
      .filter((m) => m.content.trim().length > 0 && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

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
      phase: 'thinking',
      statusLabel: 'Düşünüyor...',
    };

    const historyTurns: ChatTurn[] = [
      ...validPriorTurns,
      { role: 'user', content: trimmed },
    ];

    const convTitle = existingConv?.title ?? deriveConversationTitle(trimmed);

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
        title: convTitle,
        model: selectedModel,
        updatedAt: Date.now(),
        messages: [userMsg, assistantPlaceholder],
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveId(targetConvId);
    }

    setInput('');
    await streamToAssistant(targetConvId, assistantId, historyTurns, selectedModel, {
      title: convTitle,
      isNewConversation: !existingConv,
      userMessage: userMsg,
    });
  };

  const handleRetryMessage = (failedAssistantId: string) => {
    if (!activeConversation || streamingConvId) return;
    const idx = activeConversation.messages.findIndex((m) => m.id === failedAssistantId);
    if (idx === -1) return;

    const priorMessages = activeConversation.messages.slice(0, idx);
    const historyTurns: ChatTurn[] = priorMessages
      .filter((m) => m.content.trim().length > 0 && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    const lastUserTurn = [...historyTurns].reverse().find((t) => t.role === 'user');
    if (!lastUserTurn) return;

    const userMsg = [...priorMessages].reverse().find((m) => m.role === 'user');

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
                      durationMs: undefined,
                      engine: undefined,
                      model: selectedModel,
                      phase: 'thinking' as const,
                      statusLabel: 'Düşünüyor...',
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
      selectedModel,
      userMsg
        ? {
            title: activeConversation.title,
            isNewConversation: false,
            userMessage: userMsg,
          }
        : undefined
    );
  };

  const isStreaming = streamingConvId !== null;
  const userLabel =
    user?.displayName?.trim() || user?.email?.split('@')[0] || 'Helyume Üyesi';

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#06080d] text-slate-100">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        isOpenMobile={isMobileSidebarOpen}
        user={user}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onOpenAuth={(mode) => setAuthModalMode(mode)}
        onSignOut={handleSignOut}
      />

      <div className="relative flex flex-1 min-w-0 flex-col h-full">
        <header className="flex items-center justify-between gap-4 px-4 sm:px-6 h-14 shrink-0 border-b border-white/[0.07] bg-[#06080d]/85 backdrop-blur-md z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Menüyü aç"
              className="md:hidden p-2 -ml-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <HelyumeLogo className="w-6 h-6 shrink-0 md:hidden" />
            <h1 className="font-display text-sm sm:text-base font-semibold truncate text-white">
              {activeConversation ? activeConversation.title : 'Helyume'}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {user ? (
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04]">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={userLabel}
                      referrerPolicy="no-referrer"
                      className="w-5 h-5 rounded-full object-cover"
                    />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-200 flex items-center justify-center text-[11px] font-semibold">
                      {userLabel[0]?.toUpperCase() ?? 'H'}
                    </span>
                  )}
                  <span className="hidden sm:inline text-xs font-medium text-slate-200 max-w-[140px] truncate">
                    {userLabel}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  aria-label="Çıkış Yap"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/[0.09] bg-white/[0.03] text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.08] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Çıkış Yap</span>
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setAuthModalMode('login')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/[0.1] bg-white/[0.03] text-xs font-medium text-slate-200 hover:bg-white/[0.08] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Giriş Yap</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAuthModalMode('register')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-slate-950 text-xs font-semibold hover:bg-slate-200 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Kayıt Ol</span>
                </button>
              </>
            )}
          </div>
        </header>

        <main ref={scrollContainerRef} className="relative flex-1 overflow-y-auto">
          {loadingConvId && loadingConvId === activeId ? (
            <div className="mx-auto flex min-h-full max-w-3xl items-center justify-center px-6 py-12">
              <div className="inline-flex items-center gap-2.5 text-sm font-medium text-slate-400">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                <span>Sohbet yükleniyor...</span>
              </div>
            </div>
          ) : !activeConversation || activeConversation.messages.length === 0 ? (
            <div className="relative mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-4 sm:px-6 py-10">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 h-64 w-[480px] max-w-full rounded-full bg-[radial-gradient(ellipse_at_center,rgba(56,189,248,0.12),rgba(139,92,246,0.08)_48%,transparent_75%)] blur-2xl"
              />

              <div className="relative mb-6 flex items-center justify-center">
                <HelyumeLogo className="w-16 h-16 drop-shadow-[0_12px_28px_rgba(34,211,238,0.22)]" />
              </div>

              <h2
                className="relative font-display text-3xl sm:text-5xl font-bold tracking-tight text-center text-white"
                style={{ textWrap: 'balance' }}
              >
                Nasılsın?
              </h2>
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
          onSelectModel={handleModelChange}
        />
      </div>

      <AuthModal
        isOpen={authModalMode !== null}
        initialMode={authModalMode ?? 'login'}
        onClose={() => setAuthModalMode(null)}
      />
    </div>
  );
}
