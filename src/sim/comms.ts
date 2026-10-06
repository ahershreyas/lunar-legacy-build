/**
 * 1.28 s light-time delay on every uplink and downlink, with progress in the
 * store. Every transmission checks signal.aborted before it executes.
 */
import { useMissionStore } from "../store/useMissionStore";

export const DELAY_MS = 1280;

export class Aborted extends Error {
  constructor() { super("aborted"); }
}

export function transmit(signal: AbortSignal, label: string): Promise<void> {
  const set = useMissionStore.setState;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Aborted());
    const t0 = performance.now();
    set({ transmission: { label, progress: 0 } });
    const id = setInterval(() => {
      if (signal.aborted) {
        clearInterval(id);
        set({ transmission: null });
        reject(new Aborted());
        return;
      }
      const p = Math.min(1, (performance.now() - t0) / DELAY_MS);
      set({ transmission: { label, progress: p } });
      if (p >= 1) {
        clearInterval(id);
        set({ transmission: null });
        resolve();
      }
    }, 40);
  });
}
