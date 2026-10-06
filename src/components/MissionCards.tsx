import { useState } from "react";
import { useMissionStore } from "../store/useMissionStore";
import { choose, type Choice } from "../sim/loop";
import { formatDuration, formatEta } from "../sim/estimate";
import { RiskGauge } from "./RiskGauge";

const pad3 = (n: number) => String(((Math.round(n) % 360) + 360) % 360).padStart(3, "0");

function Btn({ c, children, tone = "telemetry", onClick }: { c?: Choice; children: React.ReactNode; tone?: "telemetry" | "hazard" | "abort" | "label"; onClick?: () => void }) {
  const cls = {
    telemetry: "border-telemetry/50 bg-telemetry/10 text-telemetry hover:bg-telemetry/20",
    hazard: "border-hazard/50 bg-hazard/10 text-hazard hover:bg-hazard/20",
    abort: "border-abort/50 bg-abort/10 text-abort hover:bg-abort/20",
    label: "border-white/15 bg-well text-label hover:text-log",
  }[tone];
  return (
    <button
      onClick={onClick ?? (() => c && choose(c))}
      className={`flex-1 rounded border px-2 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${cls}`}
    >
      {children}
    </button>
  );
}

function Shell({ status, tone, children }: { status: string; tone: string; children: React.ReactNode }) {
  return (
    <section className="pointer-events-auto w-[380px] max-w-full space-y-3 rounded-md border border-white/15 bg-card/95 p-3 shadow-lg backdrop-blur">
      <div className={`font-mono text-[10px] uppercase tracking-[0.2em] ${tone}`}>{status}</div>
      {children}
    </section>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-3 font-mono text-[11px]">
    <span className="uppercase tracking-wider text-label">{k}</span>
    <span className="text-right text-log">{v}</span>
  </div>
);

export function MissionCards() {
  const pending = useMissionStore((s) => s.pending);
  const quote = useMissionStore((s) => s.quote);
  const proposal = useMissionStore((s) => s.proposal);
  const running = useMissionStore((s) => s.running);
  const [reason, setReason] = useState("");

  if (pending?.kind === "approve" && quote) {
    return (
      <Shell status="● Awaiting approval" tone="text-telemetry">
        <Row k="Target" v={`${quote.target.name} · brg ${pad3(quote.target.bearing)} · ${quote.target.distance_m.toLocaleString()} m`} />
        <Row k="Strategy" v={quote.strategy} />
        <Row k="Duration" v={formatDuration(quote.etaSeconds)} />
        <Row k="Power req." v={`${quote.batteryCostPct.toFixed(1)}% of full charge`} />
        <Row k="Route" v={`${Math.round(quote.metres).toLocaleString()} m · ${quote.legs.length} stations · ${quote.drills} drill`} />
        <RiskGauge q={quote} />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason if rejecting (optional)"
          className="h-8 w-full rounded border border-white/10 bg-well px-2 font-mono text-[11px] text-log placeholder:text-label/60 focus:outline-none"
        />
        <div className="flex gap-2">
          <Btn c="approve">Approve &amp; Uplink</Btn>
          <Btn tone="abort" onClick={() => { choose("reject", reason.trim()); setReason(""); }}>Reject</Btn>
        </div>
      </Shell>
    );
  }

  if (pending?.kind === "refuse") {
    return (
      <Shell status="■ Holding — rover refused" tone="text-abort">
        <p className="font-mono text-[11px] text-log">{pending.reason}</p>
        {pending.alternative && (
          <div className="rounded border border-hazard/30 bg-hazard/5 p-2 font-mono text-[11px] text-hazard">
            ALTERNATE: {pending.alternative.description} · brg {pad3(pending.alternative.bearing)} · {Math.round(pending.alternative.distance_m)} m
            {pending.altQuote && (
              <span className="block text-label">
                {formatDuration(pending.altQuote.etaSeconds)} · {pending.altQuote.batteryCostPct.toFixed(1)}% power · risk {pending.altQuote.riskPct}%
              </span>
            )}
          </div>
        )}
        <div className="flex gap-2">
          {pending.alternative && <Btn c="accept_alt">Accept Alternate</Btn>}
          <Btn c="override" tone="hazard">Override — Accept Risk</Btn>
          <Btn c="abort" tone="abort">Abort Sortie</Btn>
        </div>
      </Shell>
    );
  }

  if (pending?.kind === "confirm") {
    return (
      <Shell status="▲ Override — confirmation required" tone="text-hazard">
        <p className="font-mono text-[11px] text-log">{pending.transmission}</p>
        <p className="font-mono text-[10px] text-label">{pending.reason}{pending.riskPct !== null ? ` · computed risk ${pending.riskPct}%` : ""}</p>
        <div className="flex gap-2">
          <Btn c="confirm" tone="hazard">Confirm — I accept the risk</Btn>
          <Btn c="abort" tone="abort">Abort Sortie</Btn>
        </div>
      </Shell>
    );
  }

  if (pending?.kind === "caution") {
    return (
      <Shell status="▲ Holding — caution" tone="text-hazard">
        <p className="font-mono text-[11px] text-log">{pending.reason}</p>
        <div className="flex gap-2">
          <Btn c="proceed">Proceed</Btn>
          {pending.alternative && (
            <Btn c="longer" tone="hazard">
              Take the longer route
              {pending.timeCostS !== null && ` (${pending.timeCostS >= 0 ? "+" : "−"}${formatEta(Math.abs(pending.timeCostS))})`}
            </Btn>
          )}
        </div>
      </Shell>
    );
  }

  if (proposal && !running) {
    return (
      <Shell status="◆ Mission Control proposal" tone="text-telemetry">
        <Row k="Target" v={`${proposal.target} · brg ${pad3(proposal.bearing)} · ${proposal.distance_m.toLocaleString()} m`} />
        <p className="font-mono text-[11px] text-log">{proposal.rationale}</p>
        <div className="flex gap-2">
          <Btn
            onClick={() =>
              useMissionStore.setState({
                draft: `Proceed to ${proposal.target}, bearing ${pad3(proposal.bearing)}, ${proposal.distance_m} m — ${proposal.rationale}`,
                proposal: null,
              })
            }
          >
            Accept Proposal
          </Btn>
          <Btn tone="label" onClick={() => useMissionStore.setState({ proposal: null })}>Dismiss</Btn>
        </div>
      </Shell>
    );
  }
  return null;
}

export function TransmissionBar() {
  const tx = useMissionStore((s) => s.transmission);
  if (!tx) return null;
  return (
    <div className="rounded-md border border-white/10 bg-card px-3 py-2 font-mono text-[10px]">
      <div className="mb-1 flex justify-between uppercase tracking-widest text-telemetry">
        <span>{tx.label}</span>
        <span className="tabular-nums">{(tx.progress * 1.28).toFixed(2)} / 1.28 s</span>
      </div>
      <div className="h-1 rounded bg-white/10">
        <div className="h-full rounded bg-telemetry" style={{ width: `${tx.progress * 100}%` }} />
      </div>
    </div>
  );
}

export function LiveProgress() {
  const p = useMissionStore((s) => s.progress);
  const running = useMissionStore((s) => s.running);
  if (!p || !running) return null;
  const f = p.totalM ? p.doneM / p.totalM : 0;
  return (
    <div className="space-y-1.5 rounded-md border border-white/10 bg-card px-3 py-2 font-mono text-[11px]">
      <div className="flex justify-between">
        <span className="uppercase tracking-wider text-label">Distance remaining</span>
        <span className="tabular-nums text-telemetry">{Math.round(p.remainingM).toLocaleString()} m</span>
      </div>
      <div className="flex justify-between">
        <span className="uppercase tracking-wider text-label">ETA</span>
        <span className="tabular-nums text-telemetry">{formatEta(p.etaS)}</span>
      </div>
      <div className="h-1.5 rounded bg-white/10">
        <div className="h-full rounded bg-path" style={{ width: `${Math.min(100, f * 100)}%` }} />
      </div>
      <div className="text-right text-[10px] tabular-nums text-label">
        {Math.round(p.doneM).toLocaleString()} / {Math.round(p.totalM).toLocaleString()} m traversed
      </div>
    </div>
  );
}
