import { CheckCircle2, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { signInWithGoogleAccount } from '../lib/firebase';
import { HelyumeLogo } from './HelyumeLogo';

export type AuthModalMode = 'login' | 'register';

interface AuthModalProps {
  isOpen: boolean;
  initialMode: AuthModalMode;
  onClose: () => void;
}

function mapFirebaseAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (raw.includes('auth/popup-closed-by-user')) {
    return 'Giriş penceresi kapatıldı. Devam etmek için tekrar deneyebilirsiniz.';
  }
  if (raw.includes('auth/popup-blocked')) {
    return 'Tarayıcı açılır pencereyi engelledi. Lütfen açılır pencerelere izin verip tekrar deneyin.';
  }
  if (raw.includes('auth/network-request-failed')) {
    return 'Ağ bağlantısı kurulamadı. İnternet bağlantınızı kontrol edin.';
  }
  return 'Hesap doğrulaması sırasında bir sorun oluştu. Lütfen tekrar deneyin.';
}

export function AuthModal({ isOpen, initialMode, onClose }: AuthModalProps) {
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
  }, [initialMode, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogleAccount();
      onClose();
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="helyume-auth-title"
    >
      <div
        className="fixed inset-0"
        aria-hidden="true"
        onClick={() => {
          if (!loading) onClose();
        }}
      />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.12] bg-[#0c1018] p-6 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <HelyumeLogo className="w-9 h-9 shrink-0" />
            <div>
              <h2 id="helyume-auth-title" className="font-display text-lg font-bold text-white">
                {mode === 'register' ? 'Helyume Hesabı Oluştur' : 'Helyume’e Giriş Yap'}
              </h2>
              <p className="text-xs text-slate-400">
                Sohbet geçmişin bulutta güvenle saklansın
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Hesap işlemi seçimi"
          className="mt-5 grid grid-cols-2 gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              mode === 'login'
                ? 'bg-white/[0.12] text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Giriş Yap
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              mode === 'register'
                ? 'bg-white/[0.12] text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Kayıt Ol
          </button>
        </div>

        <div className="mt-5 space-y-2.5 text-xs text-slate-300">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
            <span>Tüm sohbetlerin cihazlar arasında otomatik eşitlenir</span>
          </div>
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
            <span>Helyume Crush, Aura ve Void tercihlerin korunur</span>
          </div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
            <span>Doğrulanmış Google hesabı ile tek tıkla güvenli erişim</span>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-500/30 bg-red-950/35 px-3.5 py-2.5 text-xs text-red-200 leading-relaxed"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-2.5">
          <button
            type="button"
            onClick={handleGoogleAuth}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 transition-colors disabled:opacity-60 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>
              {loading
                ? 'Bağlanıyor...'
                : mode === 'register'
                  ? 'Google ile Hemen Kayıt Ol'
                  : 'Google ile Giriş Yap'}
            </span>
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-full py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            Şimdilik misafir olarak devam et
          </button>
        </div>
      </div>
    </div>
  );
}
