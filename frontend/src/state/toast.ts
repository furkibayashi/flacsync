import { useSyncExternalStore } from 'react';

/**
 * Uygulama genelinde kısa bildirimler (toast). Bir işlem bittiğinde ya da başarısız olduğunda
 * kullanıcıya söylenir; geri alınabilen işlemlerde "Geri al" düğmesi olur. Ekran okuyuculara da
 * duyurulur (Toaster, aria-live bölgesi).
 */
export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
  /** ms; 0 = kullanıcı kapatana kadar */
  duration: number;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const l of listeners) l();
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(input: { message: string; kind?: Toast['kind']; action?: Toast['action']; duration?: number }): number {
  const id = nextId++;
  const item: Toast = {
    id,
    message: input.message,
    kind: input.kind ?? 'info',
    action: input.action,
    // Geri alınabilen ve hata bildirimleri biraz daha uzun kalır
    duration: input.duration ?? (input.action ? 8000 : input.kind === 'error' ? 7000 : 4000),
  };
  // En fazla 3 bildirim üst üste
  toasts = [...toasts.slice(-2), item];
  if (item.duration > 0) timers.set(id, setTimeout(() => dismissToast(id), item.duration));
  emit();
  return id;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts, () => toasts);
}
