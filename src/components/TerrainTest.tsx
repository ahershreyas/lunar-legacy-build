import { useMissionStore, LANDING_SITE } from "../store/useMissionStore";
import { emergencyHold, controlIdleProposal } from "../sim/loop";
import { unlockAudio, speak } from "../utils/radioVoice";
export function TerrainTest() {
  const running = useMissionStore((s) => s.running);
  const terrain = useMissionStore((s) => s.terrain);
  return (
    <section className="rounded border border-white/15 bg-card p-3 text-xs text-label">
      <strong className="block mb-2 text-telemetry">FIELD TEST · REAL CRATER RIM</strong>
      <p className="mb-2">
        Safe staging point beside slopes exceeding 30°. Terrain and core readings come from the
        supplied data.
      </p>
      <button
        disabled={running || !terrain}
        className="text-telemetry disabled:opacity-40"
        onClick={() => {
          emergencyHold();
          Object.assign(LANDING_SITE, { col: 204, row: 388 });
          useMissionStore.setState({
            col: 204,
            row: 388,
            heading: 0,
            battery: 100,
            status: "IDLE",
            samples: [],
            trail: [{ col: 204, row: 388 }],
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
              "FIELD TEST STAGING — crater rim, grid 204 / 388. New home reference; nearby steep terrain.",
            );
          void controlIdleProposal();
        }}
      >
        STAGE AT CRATER RIM
      </button>
      <button
        className="block mt-2 text-telemetry"
        onClick={() => {
          unlockAudio();
          speak(
            "CONTROL",
            "Rover One, Mission Control. Radio check. Ground voice on uplink, standing by.",
          );
          speak(
            "ROVER 1",
            "Mission Control, Rover One. I read you clearly. Rover voice on downlink. Ready for the traverse.",
          );
        }}
      >
        TEST BOTH RADIO VOICES
      </button>
    </section>
  );
}
