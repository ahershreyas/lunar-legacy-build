import { afterEach, describe, expect, it, vi } from "vitest";
import { requestMicrophone } from "../utils/microphone";
afterEach(() => vi.useRealTimers());
describe("Microphone permission", () => {
  it("times out and releases a stream granted after the permission deadline", async () => {
    vi.useFakeTimers();
    let grant!: (s: MediaStream) => void;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise<MediaStream>((r) => {
            grant = r;
          }),
      },
    });
    const result = requestMicrophone(new AbortController().signal, 1000).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).message).toContain("No microphone permission response");
    const stop = vi.fn();
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });
  it("allows cancelling a permission request without leaving the button waiting", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => new Promise(() => {}) },
    });
    const c = new AbortController();
    const result = requestMicrophone(c.signal).catch((e) => e);
    c.abort();
    expect((await result).message).toContain("cancelled");
  });
});
