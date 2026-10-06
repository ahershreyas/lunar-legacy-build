import { useState, useEffect } from "react";
import { useMissionStore, LANDING_SITE } from "../store/useMissionStore";
import { emergencyHold, controlIdleProposal } from "../sim/loop";
import { unlockAudio, speak, setRadioVoice } from "../utils/radioVoice";
export function TerrainTest() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const update = () =>
      setVoices(
        speechSynthesis
          .getVoices()
          .filter(
            (v) =>
              v.lang.startsWith("en") &&
              !/Albert|Bells|Boing|Zarvox|Whisper|Trinoids/i.test(v.name),
          ),
      );
    update();
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  const running = useMissionStore((s) => s.running);
  const terrain = useMissionStore((s) => s.terrain);
  return (
    <section className="rounded border border-white/15 bg-card p-3 text-xs text-label">
      <strong className="block mb-2 text-telemetry">FIELD TEST · BRIGHT HIGHLANDS</strong>
      <p className="mb-2">
        The bright highland patch marked on the overview. Real 20 m DEM relief; rendering fill light
        improves visibility without changing the sensor readings.
      </p>
      <button
        disabled={running || !terrain}
        className="text-telemetry disabled:opacity-40"
        onClick={() => {
          emergencyHold();
          Object.assign(LANDING_SITE, { col: 352, row: 318 });
          useMissionStore.setState({
            col: 352,
            row: 318,
            heading: 0,
            battery: 100,
            status: "IDLE",
            samples: [],
            trail: [{ col: 352, row: 318 }],
            plannedPath: [],
            detour: null,
            summary: null,
            pending: null,
            quote: null,
            proposal: null,
            progress: null,
          });
          useMissionStore
            .getState()
            .appendLog(
              "SYSTEM",
              "FIELD TEST STAGING — bright highlands, grid 352 / 318. New home reference; real elevated terrain.",
            );
          void controlIdleProposal();
        }}
      >
        STAGE AT BRIGHT HIGHLANDS
      </button>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(["CONTROL", "ROVER 1"] as const).map((role) => (
          <label key={role}>
            {role === "CONTROL"
              ? "Ground voice (browser fallback)"
              : "Rover voice (browser fallback)"}
            <select
              aria-label={`${role === "CONTROL" ? "Ground" : "Rover"} radio voice`}
              className="mt-1 w-full bg-well p-1"
              onChange={(e) => setRadioVoice(role, e.target.value)}
            >
              <option value="">Lovable neural · {role === "CONTROL" ? "Onyx" : "Nova"}</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button
        className="block mt-2 text-telemetry"
        onClick={() => {
          unlockAudio();
          speak(
            "CONTROL",
            "Rover One, Mission Control. Radio check. Ground voice (browser fallback) on uplink, standing by.",
          );
          speak(
            "ROVER 1",
            "Mission Control, Rover One. I read you clearly. Rover voice (browser fallback) on downlink. Ready for the traverse.",
          );
        }}
      >
        TEST BOTH RADIO VOICES
      </button>
    </section>
  );
}
