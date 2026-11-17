import type { ChatAttachment } from './storage';

const MAX_IMAGE_FILE_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_FILE_BYTES = 3.8 * 1024 * 1024;
const TARGET_IMAGE_DIMENSION = 1600;

function createAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `att_${crypto.randomUUID()}`;
  }
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Dosya okunamadı.'));
      }
    };
    reader.onerror = () => reject(new Error('Dosya okunurken bir hata oluştu.'));
    reader.readAsDataURL(blob);
  });
}

async function compressImageIfNeeded(file: File): Promise<{
  mimeType: string;
  dataBase64: string;
  previewUrl: string;
}> {
  const originalDataUrl = await readBlobAsDataUrl(file);
  const commaIdx = originalDataUrl.indexOf(',');
  const rawBase64 = commaIdx >= 0 ? originalDataUrl.slice(commaIdx + 1) : originalDataUrl;

  if (file.type === 'image/gif' || file.size <= 900 * 1024) {
    return {
      mimeType: file.type || 'image/png',
      dataBase64: rawBase64,
      previewUrl: originalDataUrl,
    };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, TARGET_IMAGE_DIMENSION / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({
          mimeType: file.type || 'image/jpeg',
          dataBase64: rawBase64,
          previewUrl: originalDataUrl,
        });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const outMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      let outUrl = canvas.toDataURL(outMime, 0.86);
      if (outUrl.length > 2_000_000) {
        outUrl = canvas.toDataURL('image/jpeg', 0.8);
      }
      const idx = outUrl.indexOf(',');
      const mimeMatch = /^data:([^;]+);base64,/.exec(outUrl);
      resolve({
        mimeType: mimeMatch?.[1] ?? 'image/jpeg',
        dataBase64: idx >= 0 ? outUrl.slice(idx + 1) : outUrl,
        previewUrl: outUrl,
      });
    };
    img.onerror = () => {
      resolve({
        mimeType: file.type || 'image/jpeg',
        dataBase64: rawBase64,
        previewUrl: originalDataUrl,
      });
    };
    img.src = originalDataUrl;
  });
}

export async function prepareMediaAttachment(file: File): Promise<ChatAttachment> {
  const lowerType = file.type.toLowerCase();
  const isImage =
    lowerType === 'image/png' ||
    lowerType === 'image/jpeg' ||
    lowerType === 'image/jpg' ||
    lowerType === 'image/webp' ||
    lowerType === 'image/gif';
  const isVideo =
    lowerType === 'video/mp4' ||
    lowerType === 'video/webm' ||
    lowerType === 'video/quicktime';

  if (!isImage && !isVideo) {
    throw new Error('Desteklenen formatlar: PNG, JPG, WEBP, GIF görseller veya MP4, WEBM, MOV videolar.');
  }

  if (isImage) {
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      throw new Error('Görsel boyutu en fazla 12 MB olabilir.');
    }
    const processed = await compressImageIfNeeded(file);
    return {
      id: createAttachmentId(),
      kind: 'image',
      name: file.name || 'gorsel.jpg',
      mimeType: processed.mimeType,
      sizeBytes: file.size,
      previewUrl: processed.previewUrl,
      dataBase64: processed.dataBase64,
    };
  }

  if (file.size > MAX_VIDEO_FILE_BYTES) {
    throw new Error(
      'Video boyutu hızlı analiz için en fazla 3.8 MB olabilir. Daha kısa veya sıkıştırılmış bir klip seçin.'
    );
  }

  const videoDataUrl = await readBlobAsDataUrl(file);
  const commaIdx = videoDataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? videoDataUrl.slice(commaIdx + 1) : videoDataUrl;

  return {
    id: createAttachmentId(),
    kind: 'video',
    name: file.name || 'video.mp4',
    mimeType: lowerType,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    dataBase64: base64,
  };
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
