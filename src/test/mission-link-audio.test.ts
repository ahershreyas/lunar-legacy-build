import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { aiProvider } from "../lib/ai-provider";
import { useMissionStore } from "../store/useMissionStore";
import { silence, speak, unlockAudio } from "../utils/radioVoice";

const neural = vi.hoisted(() => vi.fn());
vi.mock("../lib/rover-think.functions", () => ({ radioSpeech: neural }));
const calls: { text: string; rate: number; pitch: number; voice?: { voiceURI: string } }[] = [];
const frequencies: number[] = [];
class Node {
  frequency = { value: 0 };
  gain = { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  Q = { value: 0 };
  type = "";
  loop = false;
  buffer: unknown;
  onended: (() => void) | null = null;
  connect(n: Node) {
    return n;
  }
  disconnect() {}
  start() {}
  stop() {
    this.onended?.();
  }
}
class Audio {
  currentTime = 0;
  sampleRate = 100;
  destination = new Node();
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    const n = new Node();
    n.start = () => {
      frequencies.push(n.frequency.value);
    };
    return n;
  }
  createGain() {
    return new Node();
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(200) };
  }
  createBufferSource() {
    return new Node();
  }
  createBiquadFilter() {
    return new Node();
  }
}
class Utterance {
  rate = 1;
  pitch = 1;
  voice?: { voiceURI: string };
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
beforeEach(() => {
  silence();
  neural.mockReset().mockResolvedValue({ ok: false, message: "Test fallback" });
  vi.useFakeTimers();
  calls.length = 0;
  frequencies.length = 0;
  vi.stubGlobal("AudioContext", Audio);
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    getVoices: () => [
      { lang: "en-GB", voiceURI: "ground" },
      { lang: "en-GB", voiceURI: "rover" },
    ],
    speak: (u: Utterance) => {
      calls.push(u);
      Promise.resolve().then(() => u.onend?.());
    },
    cancel: vi.fn(),
  });
});
afterEach(() => {
  silence();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("Mission connection", () => {
  it("starts offline rather than pretending that an AI connection exists", () => {
    expect(useMissionStore.getInitialState().link).toBe("OFFLINE");
  });
  it("keeps the requested Astra model and supports server-only provider credentials", () => {
    expect(aiProvider({}).key).toBeUndefined();
    expect(aiProvider({ LOVABLE_API_KEY: "fixture" }).model).toBe("openai/gpt-6-astra");
    expect(aiProvider({ OPENAI_API_KEY: "fixture" }).url).toBe(
      "https://api.openai.com/v1/responses",
    );
    expect(aiProvider({ OPENAI_API_KEY: "fixture" }).model).toBe("gpt-6-astra");
  });
});
describe("Step 5 radio", () => {
  it("speaks both roles with distinct voices at the specified rate and pitch", async () => {
    unlockAudio();
    speak("CONTROL", "Rover 1, Mission Control. Copy.");
    speak("ROVER 1", "Mission Control, Rover 1. Standing by.");
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(2);
    expect(calls.map((u) => u.voice?.voiceURI)).toEqual(["ground", "rover"]);
    expect(calls.every((u) => u.rate === 0.9)).toBe(true);
    expect(calls.map((u) => u.pitch)).toEqual([0.94, 0.94]);
    expect(frequencies).toEqual([2525, 2475, 2525, 2475]);
  });
  it("plays neural speech for both roles before using any browser fallback", async () => {
    const played: string[] = [];
    class Clip {
      onplaying?: () => void;
      onended?: () => void;
      constructor(public src: string) {}
      pause() {}
      play() {
        played.push(this.src);
        this.onplaying?.();
        Promise.resolve().then(() => this.onended?.());
        return Promise.resolve();
      }
    }
    vi.stubGlobal("Audio", Clip);
    neural.mockImplementation(async ({ data }) => ({
      ok: true,
      audio: "fixture",
      voice: data.role === "CONTROL" ? "Onyx" : "Nova",
    }));
    speak("CONTROL", "Uplink");
    speak("ROVER 1", "Downlink");
    await vi.runAllTimersAsync();
    expect(neural.mock.calls.map(([x]) => x.data.role)).toEqual(["CONTROL", "ROVER 1"]);
    expect(played).toHaveLength(2);
    expect(calls).toHaveLength(0);
  });
  it("cancels queued radio messages when the link is silenced", async () => {
    speak("CONTROL", "Pending uplink");
    speak("ROVER 1", "Pending downlink");
    silence();
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(0);
  });
});
