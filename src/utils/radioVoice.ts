/** Browser radio: serial speech with Quindar tones, never replacing the transcript. */
let ctx: AudioContext | null = null;
let queue: Promise<void> = Promise.resolve();
let generation = 0;
let stopActive: (() => void) | null = null;
let finishActive: (() => void) | null = null;
function ac() {
  ctx ??= new AudioContext();
  return ctx;
}
export function unlockAudio() {
  if (typeof window === "undefined" || !("AudioContext" in window)) return;
  void ac()
    .resume()
    .catch(() => undefined);
}
async function quindar(freq: number) {
  const c = ac(),
    o = c.createOscillator(),
    g = c.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.12, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.08);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
  await new Promise<void>((r) => setTimeout(r, 100));
}
function noiseBed() {
  const c = ac(),
    buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate),
    ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const source = c.createBufferSource(),
    filter = c.createBiquadFilter(),
    gain = c.createGain();
  source.buffer = buf;
  source.loop = true;
  filter.type = "bandpass";
  filter.frequency.value = 1850;
  filter.Q.value = 2.2;
  gain.gain.value = 0.015;
  source.connect(filter).connect(gain).connect(c.destination);
  source.start();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    source.stop();
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}
async function utter(who: string, text: string) {
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    const voice =
      who === "CONTROL"
        ? voices[0]
        : (voices.find((v) => v.voiceURI !== voices[0]?.voiceURI) ?? voices[0]);
    if (voice) u.voice = voice;
    u.rate = 0.9;
    u.pitch = 0.94;
    const finish = () => {
      if (finishActive === finish) finishActive = null;
      resolve();
    };
    finishActive = finish;
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  });
}
export function speak(who: string, text: string) {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    !("AudioContext" in window)
  )
    return;
  const epoch = generation;
  queue = queue
    .then(async () => {
      if (epoch !== generation) return;
      const stop = noiseBed();
      stopActive = stop;
      try {
        await quindar(2525);
        if (epoch !== generation) return;
        await utter(who, text);
        if (epoch !== generation) return;
        await quindar(2475);
      } finally {
        stop();
        if (stopActive === stop) stopActive = null;
      }
    })
    .catch(() => undefined);
}
export function silence() {
  generation++;
  stopActive?.();
  stopActive = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
  finishActive?.();
  finishActive = null;
  queue = Promise.resolve();
}
