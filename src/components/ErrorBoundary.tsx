import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Beklenmeyen bir hata oluştu.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Helyume UI ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh w-full bg-[#06080d] text-slate-100 flex items-center justify-center px-4">
          <div className="max-w-md w-full rounded-2xl border border-white/[0.1] bg-[#0c1018] p-6 space-y-4">
            <h2 className="font-display text-lg font-semibold text-white">
              Geçici bir sorun oluştu
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Uygulama verileri yüklenirken beklenmeyen bir hata yaşandı. Sayfayı yenileyerek devam edebilirsiniz.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 transition-colors"
            >
              Sayfayı Yenile
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
