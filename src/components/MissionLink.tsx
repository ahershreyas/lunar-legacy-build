import { useState, useEffect } from "react";
import { Radio } from "lucide-react";
import { missionLinkStatus } from "../lib/rover-think.functions";
import { useMissionStore } from "../store/useMissionStore";
import { controlIdleProposal, emergencyHold } from "../sim/loop";
import { unlockAudio, silence } from "../utils/radioVoice";

export function MissionLink() {
  const link = useMissionStore((s) => s.link);
  const message = useMissionStore((s) => s.linkMessage);
  const provider = useMissionStore((s) => s.aiProvider);
  const ground = useMissionStore((s) => s.groundLink);
  const rover = useMissionStore((s) => s.roverLink);
  const terrain = useMissionStore((s) => s.terrain);
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    if (!terrain) return;
    let cancelled = false;
    void missionLinkStatus()
      .then((config) => {
        if (cancelled || useMissionStore.getState().link !== "OFFLINE") return;
        useMissionStore.setState({
          link: config.configured ? "READY" : "UNCONFIGURED",
          aiProvider: config.provider,
          groundLink: "STANDBY",
          roverLink: "STANDBY",
          linkMessage: config.configured
            ? "Mission server connected. Enable radio, then transmit a goal to activate both agents."
            : "No server AI credential. Initialize the link for setup instructions.",
        });
      })
      .catch(() => {
        /* The explicit initialize button remains available to retry. */
      });
    return () => {
      cancelled = true;
    };
  }, [terrain]);
  const initialize = async () => {
    // Called directly from a click: unlock browser audio before any network wait.
    unlockAudio();
    useMissionStore.setState({
      status: "IDLE",
      proposal: null,
      link: "CHECKING",
      linkMessage: "Establishing GPT-6 Astra mission link…",
      commsMode: "VOICE",
    });
    try {
      const status = await missionLinkStatus();
      if (!status.configured) {
        useMissionStore.setState({
          link: "UNCONFIGURED",
          aiProvider: status.provider,
          linkMessage:
            "No server AI credential is available in this preview. Mission Control and Rover 1 are offline.",
        });
        setSetup(true);
        return;
      }
      useMissionStore.setState({
        link: "READY",
        aiProvider: status.provider,
        groundLink: "STANDBY",
        roverLink: "STANDBY",
        linkMessage:
          "Mission Control and Rover 1 enabled. Transmit a goal, review the plan, then approve motion.",
      });
      useMissionStore
        .getState()
        .appendLog(
          "SYSTEM",
          `MISSION LINK ACTIVE — ${status.provider} · GPT-6 Astra · TEXT + VOICE.`,
        );
      await controlIdleProposal();
    } catch {
      useMissionStore.setState({
        link: "FAILED",
        linkMessage: "Mission server could not be reached. Retry the link.",
      });
    }
  };
  const disconnect = () => {
    emergencyHold();
    silence();
    useMissionStore.setState({
      link: "OFFLINE",
      groundLink: "STANDBY",
      roverLink: "STANDBY",
      proposal: null,
      linkMessage: "Mission link disconnected. Initialize to reconnect.",
    });
  };
  return (
    <section className="shrink-0 rounded-md border border-telemetry/25 bg-card p-3">
      <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-widest">
        <span className="flex items-center gap-2 text-telemetry">
          <Radio size={13} /> GPT-6 ASTRA · MISSION LINK
        </span>
        <span className={link === "READY" ? "text-nominal" : "text-hazard"}>{link}</span>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2 font-mono text-[10px] text-label">
        <div className="rounded bg-well p-2">
          MISSION CONTROL <span className="block text-telemetry">ASTRA-GROUND · {ground}</span>
        </div>
        <div className="rounded bg-well p-2">
          ROVER 1 <span className="block text-path">ASTRA-ROVER · {rover}</span>
        </div>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-label">{message}</p>
      {link !== "READY" ? (
        <button
          disabled={!terrain || link === "CHECKING"}
          onClick={() => void initialize()}
          className="w-full rounded border border-telemetry/50 bg-telemetry/10 px-3 py-2 font-mono text-[11px] text-telemetry disabled:opacity-40"
        >
          {link === "CHECKING"
            ? "ESTABLISHING MISSION LINK…"
            : "INITIALIZE MISSION LINK · ENABLE GPT + VOICE"}
        </button>
      ) : (
        <div className="flex justify-between gap-2">
          <button
            onClick={() => void initialize()}
            className="font-mono text-[10px] text-telemetry"
          >
            ENABLE GPT + NEURAL RADIO
          </button>
          <button onClick={disconnect} className="font-mono text-[10px] text-label">
            DISCONNECT LINK · {provider}
          </button>
        </div>
      )}
      {(setup || link === "UNCONFIGURED" || link === "FAILED") && (
        <details open={setup} className="mt-2 text-[11px] leading-relaxed text-label">
          <summary className="cursor-pointer text-telemetry">Mission link setup</summary>
          <p className="mt-2">
            In Lovable, enable the project’s AI connection and reopen its preview. This localhost
            preview needs its own server credential.
          </p>
          <p className="mt-2">
            For local use, set <code>OPENAI_API_KEY</code> in <code>.env.local</code> and restart
            the development server. Alternatively set <code>LOVABLE_API_KEY</code> if you have a
            gateway credential. Keys stay on the server.
          </p>
          <p className="mt-2">
            Both agents use the same connection with separate roles. Text remains visible; voice can
            be toggled in the top bar.
          </p>
        </details>
      )}
    </section>
  );
}
