import {
  Camera,
  CameraOff,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Volume2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HelyumeLogo } from './HelyumeLogo';

interface LiveAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function pcm16Base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(Math.floor(len / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
}

export function LiveAssistantModal({ isOpen, onClose }: LiveAssistantModalProps) {
  const [transport, setTransport] = useState<'connecting' | 'ws' | 'http'>('connecting');
  const [micAvailable, setMicAvailable] = useState(true);
  const [micActive, setMicActive] = useState(true);
  const [cameraActive, setCameraActive] = useState(false);
  const [isRecordingTurn, setIsRecordingTurn] = useState(false);
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [statusNote, setStatusNote] = useState('Canlı oturum başlatılıyor...');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [quickText, setQuickText] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeAudioNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const videoIntervalRef = useRef<number | null>(null);
  const micActiveRef = useRef<boolean>(true);
  const cameraActiveRef = useRef<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const transcriptsRef = useRef<TranscriptEntry[]>([]);
  const activeWavAudioRef = useRef<HTMLAudioElement | null>(null);

  micActiveRef.current = micActive;
  cameraActiveRef.current = cameraActive;
  transcriptsRef.current = transcripts;

  const stopPlaybackQueue = useCallback(() => {
    for (const node of activeAudioNodesRef.current) {
      try {
        node.stop();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    activeAudioNodesRef.current.clear();
    if (outputAudioCtxRef.current) {
      nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
    }
    if (activeWavAudioRef.current) {
      activeWavAudioRef.current.pause();
      activeWavAudioRef.current = null;
    }
    setIsAssistantSpeaking(false);
  }, []);

  const appendTranscript = useCallback((role: 'user' | 'assistant', text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role) {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          text: `${last.text}${last.text.endsWith(' ') || clean.startsWith(' ') ? '' : ' '}${clean}`,
        };
        return updated;
      }
      return [
        ...prev.slice(-18),
        { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, role, text: clean },
      ];
    });
  }, []);

  const playPcm24Chunk = useCallback((base64Pcm: string) => {
    const ctx = outputAudioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const samples = pcm16Base64ToFloat32(base64Pcm);
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.02, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;
    setIsAssistantSpeaking(true);
    activeAudioNodesRef.current.add(source);
    source.onended = () => {
      activeAudioNodesRef.current.delete(source);
      if (activeAudioNodesRef.current.size === 0) {
        setIsAssistantSpeaking(false);
      }
    };
  }, []);

  const captureCameraFrameBase64 = useCallback((): string | null => {
    const video = videoElRef.current;
    if (!video || !cameraActiveRef.current || video.readyState < 2) return null;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const scale = Math.min(1, 640 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    const commaIdx = dataUrl.indexOf(',');
    return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : null;
  }, []);

  const cleanupResources = useCallback(() => {
    stopPlaybackQueue();

    if (videoIntervalRef.current !== null) {
      window.clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore
      }
    }
    mediaRecorderRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      void inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }

    if (outputAudioCtxRef.current) {
      void outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }
  }, [stopPlaybackQueue]);

  useEffect(() => {
    if (!isOpen) {
      cleanupResources();
      return;
    }

    let cancelled = false;
    setErrorMsg(null);
    setTranscripts([]);
    setTransport('connecting');
    setStatusNote('Mikrofon ve canlı ses bağlantısı kuruluyor...');
    setMicAvailable(true);
    setMicActive(true);
    micActiveRef.current = true;

    const setup = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;
        setMicAvailable(true);

        const outCtx = new AudioContext({ sampleRate: 24000 });
        outputAudioCtxRef.current = outCtx;
        nextStartTimeRef.current = outCtx.currentTime;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/live`);
        wsRef.current = ws;

        let settled = false;
        const fallbackTimer = window.setTimeout(() => {
          if (!settled && !cancelled) {
            settled = true;
            try {
              ws.close();
            } catch {
              // Ignore
            }
            wsRef.current = null;
            setTransport('http');
            setStatusNote('Sesli + kameralı anlık tur modu hazır. Konuşmak için basılı tutun veya tıklayın.');
          }
        }, 3500);

        ws.onopen = () => {
          if (cancelled) return;
          setStatusNote('Gemini Live oturumuna bağlanılıyor...');
        };

        ws.onmessage = (event) => {
          if (cancelled) return;
          try {
            const msg = JSON.parse(event.data as string) as {
              type?: string;
              data?: string;
              text?: string;
              message?: string;
            };
            if (msg.type === 'ready') {
              settled = true;
              window.clearTimeout(fallbackTimer);
              setTransport('ws');
              setStatusNote('Canlı ses bağlantısı aktif — konuşabilirsiniz');

              if (!inputAudioCtxRef.current && mediaStreamRef.current) {
                const inCtx = new AudioContext({ sampleRate: 16000 });
                inputAudioCtxRef.current = inCtx;
                const source = inCtx.createMediaStreamSource(mediaStreamRef.current);
                const processor = inCtx.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;
                source.connect(processor);
                processor.connect(inCtx.destination);
                processor.onaudioprocess = (e) => {
                  if (!micActiveRef.current || ws.readyState !== WebSocket.OPEN) return;
                  const pcmBase64 = float32ToPcm16Base64(e.inputBuffer.getChannelData(0));
                  ws.send(JSON.stringify({ audio: pcmBase64 }));
                };
              }
            } else if (msg.type === 'audio' && msg.data) {
              playPcm24Chunk(msg.data);
            } else if (msg.type === 'inputTranscript' && msg.text) {
              appendTranscript('user', msg.text);
            } else if (msg.type === 'outputTranscript' && msg.text) {
              appendTranscript('assistant', msg.text);
            } else if (msg.type === 'interrupted') {
              stopPlaybackQueue();
            } else if (msg.type === 'error') {
              if (!settled) {
                settled = true;
                window.clearTimeout(fallbackTimer);
                ws.close();
                wsRef.current = null;
                setTransport('http');
                setStatusNote('Sesli + kameralı anlık tur modu hazır.');
              } else {
                setErrorMsg(msg.message || 'Canlı bağlantıda geçici bir sorun oluştu.');
              }
            }
          } catch {
            // Ignore malformed ws messages
          }
        };

        ws.onerror = () => {
          if (!settled && !cancelled) {
            settled = true;
            window.clearTimeout(fallbackTimer);
            wsRef.current = null;
            setTransport('http');
            setStatusNote('Sesli + kameralı anlık tur modu hazır. Konuşmak için mikrofon butonunu kullanın.');
          }
        };

        ws.onclose = () => {
          if (!settled && !cancelled) {
            settled = true;
            window.clearTimeout(fallbackTimer);
            wsRef.current = null;
            setTransport('http');
            setStatusNote('Sesli + kameralı anlık tur modu hazır.');
          }
        };
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : '';
          setMicAvailable(false);
          setErrorMsg(
            msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')
              ? 'Mikrofon izni verilmedi. Tarayıcı adres çubuğundan mikrofon izni verip tekrar deneyin.'
              : 'Mikrofon bulunamadı veya başlatılamadı. Kamera veya metin ile devam edebilirsiniz.'
          );
          setTransport('http');
          setStatusNote('Mikrofon erişimi olmadan metin veya kamera gönderebilirsiniz.');
        }
      }
    };

    void setup();
    return () => {
      cancelled = true;
      cleanupResources();
    };
  }, [isOpen, appendTranscript, cleanupResources, playPcm24Chunk, stopPlaybackQueue]);

  // Manage 1 FPS camera streaming when camera is toggled on
  const toggleCamera = async () => {
    if (cameraActive) {
      if (videoIntervalRef.current !== null) {
        window.clearInterval(videoIntervalRef.current);
        videoIntervalRef.current = null;
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }
      if (videoElRef.current) {
        videoElRef.current.srcObject = null;
      }
      setCameraActive(false);
      return;
    }

    try {
      setErrorMsg(null);
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      cameraStreamRef.current = camStream;
      setCameraActive(true);
      cameraActiveRef.current = true;

      window.setTimeout(() => {
        if (videoElRef.current) {
          videoElRef.current.srcObject = camStream;
        }
      }, 40);

      // Live API rule: send JPEG video frames at max 1 FPS
      videoIntervalRef.current = window.setInterval(() => {
        if (wsRef.current?.readyState !== WebSocket.OPEN || !cameraActiveRef.current) return;
        const jpeg = captureCameraFrameBase64();
        if (jpeg) {
          wsRef.current.send(JSON.stringify({ video: jpeg }));
        }
      }, 1000);
    } catch {
      setErrorMsg('Kamera izni alınamadı. Tarayıcı kamera ayarlarını kontrol edin.');
    }
  };

  const sendHttpLiveTurn = async (payload: {
    audioBase64?: string;
    audioMimeType?: string;
    textPrompt?: string;
  }) => {
    setIsProcessingTurn(true);
    setErrorMsg(null);
    try {
      const videoFrameBase64 = captureCameraFrameBase64() ?? undefined;
      const res = await fetch('/api/live-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          videoFrameBase64,
          history: transcriptsRef.current.slice(-6).map((t) => ({ role: t.role, content: t.text })),
        }),
      });
      const data = (await res.json()) as {
        userTranscript?: string;
        replyText?: string;
        audioBase64?: string | null;
        audioMimeType?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Canlı yanıt alınamadı.');
      }
      if (data.userTranscript) {
        appendTranscript('user', data.userTranscript);
      }
      if (data.replyText) {
        appendTranscript('assistant', data.replyText);
      }
      if (data.audioBase64) {
        stopPlaybackQueue();
        const audio = new Audio(
          `data:${data.audioMimeType || 'audio/wav'};base64,${data.audioBase64}`
        );
        activeWavAudioRef.current = audio;
        setIsAssistantSpeaking(true);
        audio.onended = () => setIsAssistantSpeaking(false);
        audio.onerror = () => setIsAssistantSpeaking(false);
        await audio.play().catch(() => setIsAssistantSpeaking(false));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sesli yanıt sırasında hata oluştu.');
    } finally {
      setIsProcessingTurn(false);
    }
  };

  const toggleHttpRecording = async () => {
    if (isRecordingTurn) {
      mediaRecorderRef.current?.stop();
      setIsRecordingTurn(false);
      return;
    }

    if (!mediaStreamRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        setMicAvailable(true);
        setErrorMsg(null);
      } catch {
        setMicAvailable(false);
        setErrorMsg('Mikrofon akışı hazır değil. Aşağıdan metin veya kamera karesi gönderebilirsiniz.');
        return;
      }
    }

    try {
      recordedChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(mediaStreamRef.current, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const idx = result.indexOf(',');
          const base64 = idx >= 0 ? result.slice(idx + 1) : '';
          if (base64) {
            void sendHttpLiveTurn({ audioBase64: base64, audioMimeType: mimeType });
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      setIsRecordingTurn(true);
    } catch {
      setErrorMsg('Ses kaydı başlatılamadı.');
    }
  };

  const handleSendQuickText = () => {
    const text = quickText.trim();
    if (!text && !cameraActive) return;
    setQuickText('');

    if (transport === 'ws' && wsRef.current?.readyState === WebSocket.OPEN) {
      if (text) {
        appendTranscript('user', text);
        wsRef.current.send(JSON.stringify({ text }));
      }
      return;
    }

    void sendHttpLiveTurn({ textPrompt: text || 'Kamerada ne görüyorsun?' });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="helyume-live-title"
    >
      <div className="relative flex flex-col w-full max-w-2xl max-h-[90dvh] rounded-2xl border border-white/[0.12] bg-[#0a0e16] shadow-[0_28px_90px_-20px_rgba(0,0,0,0.95)] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <HelyumeLogo className="w-8 h-8 shrink-0" />
            <div>
              <h2 id="helyume-live-title" className="font-display text-base font-bold text-white">
                Helyume Canlı Asistan
              </h2>
              <p className="text-xs text-slate-400">{statusNote}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Canlı asistanı kapat"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative flex flex-col items-center justify-center min-h-[210px] rounded-2xl border border-white/[0.08] bg-[#06080d] p-5 text-center overflow-hidden">
              <div
                aria-hidden="true"
                className={`absolute inset-0 transition-opacity duration-500 ${
                  isAssistantSpeaking ? 'opacity-100' : 'opacity-40'
                } bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.16),rgba(139,92,246,0.1)_45%,transparent_72%)]`}
              />
              <div className="relative flex flex-col items-center gap-3">
                <div
                  className={`p-3 rounded-full border transition-all ${
                    isAssistantSpeaking
                      ? 'border-cyan-400/50 bg-cyan-500/15 scale-105 shadow-[0_0_32px_rgba(34,211,238,0.28)]'
                      : 'border-white/[0.1] bg-white/[0.04]'
                  }`}
                >
                  <HelyumeLogo className="w-11 h-11" />
                </div>
                <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200">
                  {transport === 'connecting' || isProcessingTurn ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-300" />
                      <span>{isProcessingTurn ? 'Yanıt hazırlanıyor...' : 'Bağlanıyor...'}</span>
                    </>
                  ) : isAssistantSpeaking ? (
                    <>
                      <Volume2 className="w-3.5 h-3.5 text-cyan-300 animate-pulse" />
                      <span>Helyume konuşuyor</span>
                    </>
                  ) : isRecordingTurn ? (
                    <span className="text-rose-300 animate-pulse">Ses kaydı alınıyor...</span>
                  ) : !micAvailable ? (
                    <span>Metin / Kamera Modu</span>
                  ) : (
                    <span>{micActive ? 'Seni dinliyor' : 'Mikrofon kapalı'}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="relative flex items-center justify-center min-h-[210px] rounded-2xl border border-white/[0.08] bg-[#06080d] overflow-hidden">
              {cameraActive ? (
                <video
                  ref={videoElRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full max-h-[240px] object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-center px-4 text-slate-500">
                  <CameraOff className="w-7 h-7 opacity-70" aria-hidden="true" />
                  <p className="text-xs">
                    Kamerayı açtığında Helyume gördüklerini canlı olarak yorumlar
                  </p>
                </div>
              )}
            </div>
          </div>

          {errorMsg ? (
            <div
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-950/35 px-3.5 py-2.5 text-xs text-red-200"
            >
              {errorMsg}
            </div>
          ) : null}

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 max-h-44 overflow-y-auto space-y-2">
            {transcripts.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">
                Konuşma dökümü burada canlı olarak görünecek.
              </p>
            ) : (
              transcripts.map((entry) => (
                <div key={entry.id} className="text-xs leading-relaxed">
                  <span
                    className={`font-semibold mr-1.5 ${
                      entry.role === 'user' ? 'text-cyan-300' : 'text-violet-300'
                    }`}
                  >
                    {entry.role === 'user' ? 'Sen:' : 'Helyume:'}
                  </span>
                  <span className="text-slate-200">{entry.text}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-t border-white/[0.08] bg-[#0c1018] px-5 py-3.5 space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSendQuickText();
                }
              }}
              placeholder={
                cameraActive
                  ? 'Kameradaki görüntü hakkında soru sor...'
                  : 'Canlı asistana yazılı mesaj gönder...'
              }
              className="flex-1 rounded-xl border border-white/[0.1] bg-[#06080d] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50"
            />
            <button
              type="button"
              onClick={handleSendQuickText}
              disabled={isProcessingTurn || (!quickText.trim() && !cameraActive)}
              aria-label="Canlı asistana gönder"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.12] hover:bg-white/[0.2] disabled:opacity-40 px-3 py-2 text-xs font-medium text-white transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {transport === 'http' ? (
                <button
                  type="button"
                  onClick={toggleHttpRecording}
                  disabled={isProcessingTurn}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    isRecordingTurn
                      ? 'bg-rose-600 text-white hover:bg-rose-500'
                      : 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 hover:bg-cyan-500/30'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                  <span>{isRecordingTurn ? 'Kaydı Durdur ve Gönder' : 'Konuşmaya Başla'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setMicActive((v) => !v)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                    micActive
                      ? 'border-white/[0.15] bg-white/[0.08] text-white'
                      : 'border-rose-500/40 bg-rose-950/40 text-rose-200'
                  }`}
                >
                  {micActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  <span>{micActive ? 'Mikrofon Açık' : 'Mikrofon Kapalı'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={toggleCamera}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                  cameraActive
                    ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-200'
                    : 'border-white/[0.12] bg-white/[0.04] text-slate-300 hover:text-white'
                }`}
              >
                {cameraActive ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
                <span>{cameraActive ? 'Kamera Açık' : 'Kamerayı Aç'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600/90 hover:bg-red-500 text-xs font-semibold text-white transition-colors cursor-pointer"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span>Bitir</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
