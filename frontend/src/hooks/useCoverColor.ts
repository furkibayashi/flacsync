import { useEffect, useState } from 'react';

/**
 * Kapak görselinin baskın rengini "r g b" olarak döndürür (CSS: rgb(var(--art))).
 * Görsel CORS izni vermiyorsa veya yüklenemezse null döner; arayüz varsayılan renge düşer.
 */
export function useCoverColor(url: string | null | undefined): string | null {
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    setColor(null);
    if (!url) return;
    let cancelled = false;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        // Doygun ve orta parlaklıktaki pikseller ağırlıklı: gri/siyah/beyaz kapaklarda bile karakterli renk
        let r = 0;
        let g = 0;
        let b = 0;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i]!;
          const pg = data[i + 1]!;
          const pb = data[i + 2]!;
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          const saturation = max === 0 ? 0 : (max - min) / max;
          const lightness = (max + min) / 510;
          const weight = 0.05 + saturation * (1 - Math.abs(lightness - 0.5) * 2);
          r += pr * weight;
          g += pg * weight;
          b += pb * weight;
          total += weight;
        }
        if (total > 0) setColor(`${Math.round(r / total)} ${Math.round(g / total)} ${Math.round(b / total)}`);
      } catch {
        // CORS nedeniyle "tainted canvas" → varsayılan renk
      }
    };
    img.src = url;

    return () => {
      cancelled = true;
    };
  }, [url]);

  return color;
}
