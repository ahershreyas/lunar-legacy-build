const voiceChoice: Record<string, string> = {};
export function setRadioVoice(role: "CONTROL" | "ROVER 1", voiceURI: string) {
  voiceChoice[role] = voiceURI;
}
export let radioStatus = "RADIO STANDBY";
const listeners = new Set<() => void>();
export const subscribeRadio = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const getRadioStatus = () => radioStatus;
function status(message: string) {
  radioStatus = message;
  listeners.forEach((fn) => fn());
}
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
  if (!speechSynthesis.getVoices().length)
    await new Promise<void>((resolve) => {
      const ready = () => {
        speechSynthesis.removeEventListener("voiceschanged", ready);
        resolve();
      };
      speechSynthesis.addEventListener("voiceschanged", ready);
      setTimeout(ready, 1200);
    });
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    const preferred =
      who === "CONTROL"
        ? voices.find((v) => /Daniel|Google UK English Male|Alex/i.test(v.name))
        : voices.find((v) =>
            /Samantha|Karen|Moira|Google US English|Google UK English Female/i.test(v.name),
          );
    const natural = voices.filter(
      (v) =>
        !/Albert|Bells|Boing|Bad News|Good News|Bubbles|Cellos|Deranged|Hysterical|Trinoids|Whisper|Zarvox/i.test(
          v.name,
        ),
    );
    const first = natural[0] ?? voices[0];
    const voice =
      voices.find((v) => v.voiceURI === voiceChoice[who]) ??
      preferred ??
      (who === "CONTROL"
        ? first
        : (natural.find((v) => v.voiceURI !== first?.voiceURI) ?? voices[1] ?? first));
    if (voice) u.voice = voice;
    u.rate = 0.9;
    u.pitch = 0.94;
    u.volume = 1;
    const role = who === "CONTROL" ? "MISSION CONTROL" : "ROVER 1";
    u.onstart = () =>
      status(`${role} SPEAKING · ${voice?.name ?? voice?.voiceURI ?? "system voice"}`);
    const finish = () => {
      status(`${role} RADIO COMPLETE · ${voice?.name ?? voice?.voiceURI ?? "system voice"}`);
      if (finishActive === finish) finishActive = null;
      resolve();
    };
    finishActive = finish;
    u.onend = finish;
    u.onerror = (e) => {
      finish();
      status(`RADIO ERROR · ${e.error} · check browser audio permissions`);
    };
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
  status("RADIO STANDBY");
  stopActive?.();
  stopActive = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
  finishActive?.();
  finishActive = null;
  queue = Promise.resolve();
}
