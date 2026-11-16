import { MessageSquare, Plus, Trash2, X } from 'lucide-react';
import type { Conversation } from '../lib/storage';
import { HelyumeLogo } from './HelyumeLogo';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
}

export function Sidebar({
  conversations,
  activeId,
  isOpenMobile,
  onCloseMobile,
  onNewChat,
  onSelectChat,
  onDeleteChat,
}: SidebarProps) {
  const sidebarBody = (
    <div className="flex h-full flex-col bg-[#0a0d14] border-r border-white/[0.07]">
      <div className="flex items-center justify-between px-4 h-14 border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <HelyumeLogo className="w-6 h-6 shrink-0" />
          <span className="font-display text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
            Helyume
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Menüyü kapat"
          className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            onCloseMobile();
          }}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white text-slate-950 hover:bg-slate-200 transition-colors whitespace-nowrap shadow-sm"
        >
          <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Yeni Sohbet</span>
        </button>
      </div>

      <div className="px-4 pt-2 pb-1">
        <p className="text-[11px] font-medium tracking-wide text-slate-500">
          Sohbet Geçmişi
        </p>
      </div>

      <nav aria-label="Sohbet geçmişi" className="flex-1 overflow-y-auto px-3 py-1 space-y-1">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-xs leading-relaxed text-slate-500">
            Henüz kayıtlı bir sohbet yok. Yeni bir araştırma başlatın.
          </p>
        ) : (
          conversations.map((conv) => {
            const isActive = conv.id === activeId;
            return (
              <div
                key={conv.id}
                className={`group flex items-center gap-1 rounded-xl transition-colors ${
                  isActive
                    ? 'bg-white/[0.09] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectChat(conv.id);
                    onCloseMobile();
                  }}
                  className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 text-left text-xs font-medium"
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-65" aria-hidden="true" />
                  <span className="truncate">{conv.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteChat(conv.id)}
                  aria-label={`Sohbeti sil: ${conv.title}`}
                  className="p-2 text-slate-500 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </nav>
    </div>
  );

  return (
    <>
      <aside className="hidden md:block w-[264px] shrink-0 h-full">{sidebarBody}</aside>
      {isOpenMobile ? (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            aria-hidden="true"
            onClick={onCloseMobile}
          />
          <aside className="relative z-50 w-[280px] max-w-[85vw] h-full">{sidebarBody}</aside>
        </div>
      ) : null}
    </>
  );
}
