/**
 * Apollo-style radio voice: Quindar tones (2525 Hz in / 2475 Hz out, 80 ms,
 * gain 0.12, exponential decay) around browser speech, with a faint white-noise
 * bed band-passed at 1850 Hz (Q 2.2) held open only while transmitting.
 * Browser speechSynthesis cannot be routed through Web Audio, so the band-pass
 * shapes the noise/tone channel bed only.
 */
let ctx: AudioContext | null = null;
let queue: Promise<void> = Promise.resolve();

function ac() {
  ctx ??= new AudioContext();
  return ctx;
}

export function unlockAudio() {
  void ac().resume();
}

function quindar(freq: number) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.12, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.08);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.08);
  return new Promise<void>((r) => setTimeout(r, 100));
}

function noiseBed() {
  const c = ac();
  const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1850;
  bp.Q.value = 2.2;
  const g = c.createGain();
  g.gain.value = 0.015;
  src.connect(bp).connect(g).connect(c.destination);
  src.start();
  return () => src.stop();
}

function utter(who: string, text: string) {
  return new Promise<void>((res) => {
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    const v = who === "CONTROL" ? voices[0] : voices[1] ?? voices[0];
    if (v) u.voice = v;
    u.rate = 1.08;
    u.pitch = who === "CONTROL" ? 0.85 : 1.1;
    u.onend = () => res();
    u.onerror = () => res();
    speechSynthesis.speak(u);
  });
}

export function speak(who: string, text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  queue = queue.then(async () => {
    const stop = noiseBed();
    try {
      await quindar(2525);
      await utter(who, text);
      await quindar(2475);
    } finally {
      stop();
    }
  }).catch(() => undefined);
}

export function silence() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
}
