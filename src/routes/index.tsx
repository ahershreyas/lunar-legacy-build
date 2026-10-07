import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMissionStore } from "../store/useMissionStore";
import { loadTerrain } from "../sim/terrain";
import { PanelDrawer } from "../components/PanelDrawer";
import { PriorityMissions } from "../components/PriorityMissions";
import { TopBar } from "../components/TopBar";
import { SceneView3D } from "../components/SceneView3D";
import { MapView2D } from "../components/MapView2D";
import { SubsystemCard } from "../components/SubsystemCard";
import { SpectrometryCard } from "../components/SpectrometryCard";
import { CommsLog } from "../components/CommsLog";
import { TerrainTest } from "../components/TerrainTest";
import { MissionLink } from "../components/MissionLink";
import { GoalInput } from "../components/GoalInput";
import { LoadingScreen } from "../components/LoadingScreen";
import { MissionCards, TransmissionBar, LiveProgress } from "../components/MissionCards";
import { SortieCompleteCard, RiskPanel, Attribution } from "../components/OpsPanels";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "UMBRA — Lunar Surface Operations" },
      {
        name: "description",
        content:
          "Autonomous lunar rover operations console at the Moon's south pole. State a goal; the rover plans, drives and drills on its own.",
      },
      { property: "og:title", content: "UMBRA — Lunar Surface Operations" },
      {
        property: "og:description",
        content: "Autonomous lunar rover operations console at the Moon's south pole.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const terrain = useMissionStore((s) => s.terrain);
  const setTerrain = useMissionStore((s) => s.setTerrain);
  const appendLog = useMissionStore((s) => s.appendLog);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTerrain((loaded, total) => useMissionStore.setState({ load: { loaded, total } }))
      .then((t) => {
        if (cancelled) return;
        setTerrain(t);
        appendLog("SYSTEM", "AOS — Rover 1 nominal. Telemetry downstream.");
      })
      .catch((err) => {
        if (!cancelled) setFailed(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [setTerrain, appendLog]);

  return (
    <div className="flex h-screen flex-col bg-canvas text-foreground">
      <LoadingScreen done={terrain !== null || failed !== null} />
      <TopBar />
      <main className="flex min-h-0 flex-1 gap-3 p-3">
        <div className="relative min-w-0" style={{ flex: "65 1 0%" }}>
          {failed ? (
            <div className="flex h-full items-center justify-center rounded-md border border-white/10 bg-card font-mono text-xs text-abort">
              LOS — TERRAIN DOWNLINK FAILED: {failed}
            </div>
          ) : (
            <SceneView3D />
          )}
          {terrain && (
            <div className="absolute bottom-3 left-3 z-10 w-48 max-w-[45%] shadow-lg">
              <PanelDrawer title="Lunar overview" defaultOpen={false}>
                <div className="h-40">
                  <MapView2D overview />
                </div>
              </PanelDrawer>
            </div>
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col gap-3" style={{ flex: "35 1 0%" }}>
          <div className="min-h-0 flex-[2.4] space-y-3 overflow-y-auto">
            <MissionCards />
            <PanelDrawer title="Mission Control">
              <MissionLink />
              <PriorityMissions />
            </PanelDrawer>
            <PanelDrawer title="Sortie report">
              <SortieCompleteCard />
            </PanelDrawer>
            <PanelDrawer title="Field test & radio" defaultOpen={false}>
              <TerrainTest />
            </PanelDrawer>
            <PanelDrawer title="Subsystem telemetry">
              <SubsystemCard />
            </PanelDrawer>
            <PanelDrawer title="Science payload" defaultOpen={false}>
              <SpectrometryCard />
            </PanelDrawer>
            <PanelDrawer title="Risk & progress">
              <RiskPanel />
              <LiveProgress />
              <TransmissionBar />
            </PanelDrawer>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PanelDrawer title="Radio downlink">
              <CommsLog />
            </PanelDrawer>
          </div>
        </div>
      </main>
      <GoalInput />
      <Attribution />
    </div>
  );
}
