import { LogIn, LogOut, MessageSquare, Plus, Trash2, UserPlus, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { Conversation } from '../lib/storage';
import { HelyumeLogo } from './HelyumeLogo';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  isOpenMobile: boolean;
  user: User | null;
  onCloseMobile: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onSignOut: () => void;
}

export function Sidebar({
  conversations,
  activeId,
  isOpenMobile,
  user,
  onCloseMobile,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onOpenAuth,
  onSignOut,
}: SidebarProps) {
  const displayName =
    user?.displayName?.trim() || user?.email?.split('@')[0] || 'Helyume Üyesi';
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const sidebarBody = (
    <div className="flex h-full flex-col bg-[#090c12] border-r border-white/[0.07]">
      <div className="flex items-center justify-between px-4 h-14 border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <HelyumeLogo className="w-7 h-7 shrink-0" />
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
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white text-slate-950 hover:bg-slate-200 transition-colors whitespace-nowrap shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Yeni Sohbet</span>
        </button>
      </div>

      <div className="px-4 pt-1 pb-1.5">
        <p className="text-[11px] font-medium tracking-wide text-slate-500">
          {user ? 'Bulut Sohbet Geçmişi' : 'Sohbet Geçmişi'}
        </p>
      </div>

      <nav aria-label="Sohbet geçmişi" className="flex-1 overflow-y-auto px-3 py-1 space-y-1">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-xs leading-relaxed text-slate-500">
            Henüz kayıtlı bir sohbet yok. Yeni bir konuşma başlatın.
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
                  className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 text-left text-xs font-medium cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-65" aria-hidden="true" />
                  <span className="truncate">{conv.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteChat(conv.id)}
                  aria-label={`Sohbeti sil: ${conv.title}`}
                  className="p-2 text-slate-500 hover:text-red-400 transition-colors shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </nav>

      <div className="p-3 border-t border-white/[0.07]">
        {user ? (
          <div className="flex items-center justify-between gap-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] px-3 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={displayName}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover shrink-0 border border-white/15"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-200 flex items-center justify-center text-xs font-semibold shrink-0 border border-cyan-400/20">
                  {initials || 'H'}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{displayName}</p>
                <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Çıkış Yap"
              title="Çıkış Yap"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onCloseMobile();
                onOpenAuth('login');
              }}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.1] bg-white/[0.03] text-xs font-medium text-slate-200 hover:bg-white/[0.08] transition-colors whitespace-nowrap cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Giriş Yap</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onCloseMobile();
                onOpenAuth('register');
              }}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.12] text-xs font-semibold text-white hover:bg-white/[0.18] transition-colors whitespace-nowrap cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Kayıt Ol</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden md:block w-[272px] shrink-0 h-full">{sidebarBody}</aside>
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
