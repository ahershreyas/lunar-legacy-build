import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const transcription = vi.hoisted(() => vi.fn());
vi.mock("../lib/rover-think.functions", () => ({ transcribeUplink: transcription }));
import { PushToTalk } from "../components/OpsPanels";
import { PanelDrawer } from "../components/PanelDrawer";
import { MissionCards } from "../components/MissionCards";
vi.mock("../sim/loop", () => ({ choose: vi.fn(), runMission: vi.fn() }));
import { useMissionStore } from "../store/useMissionStore";
let root: Root, host: HTMLDivElement;
let recorder: FakeRecorder;
const stop = vi.fn();
class FakeRecorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    recorder = this; // eslint-disable-line @typescript-eslint/no-this-alias -- expose the fake device to the test
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["spoken mission"]) });
    this.onstop?.();
  }
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
  });
  transcription.mockReset();
  stop.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  useMissionStore.setState({ draft: "", pending: null, proposal: null });
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const click = async (button: Element) =>
  act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
describe("Operator controls", () => {
  it("records on click and transcribes to an editable draft without sending a mission", async () => {
    transcription.mockResolvedValue({ ok: true, text: "Drive five metres east and return." });
    await act(() => root.render(<PushToTalk disabled={false} />));
    await click(host.querySelector("button")!);
    expect(recorder.state).toBe("recording");
    expect(host.textContent).toContain("Stop recording");
    await click(host.querySelector("button")!);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(transcription).toHaveBeenCalledTimes(1);
    expect(useMissionStore.getState().draft).toBe("Drive five metres east and return.");
    expect(host.textContent).toContain("review");
    expect(stop).toHaveBeenCalled();
  });
  it("keeps the button visible and explains denied microphone access", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    await act(() => root.render(<PushToTalk disabled={false} />));
    await click(host.querySelector("button")!);
    expect(host.textContent).toContain("Microphone access denied");
    expect(transcription).not.toHaveBeenCalled();
  });
  it("collapses and restores a drawer without unmounting its content", async () => {
    await act(() =>
      root.render(
        <PanelDrawer title="Map">
          <input defaultValue="zoom state" />
        </PanelDrawer>,
      ),
    );
    await click(host.querySelector("button")!);
    expect(host.querySelector("[hidden]")).not.toBeNull();
    await click(host.querySelector("button")!);
    expect(host.querySelector("[hidden]")).toBeNull();
    expect(host.querySelector("input")!.value).toBe("zoom state");
  });
  it("keeps operator decision buttons accessible while details are collapsed", async () => {
    useMissionStore.setState({ pending: { kind: "pause", reason: "Check slope" } });
    await act(() => root.render(<MissionCards />));
    await click(host.querySelector("button")!);
    const resume = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Resume decisions"),
    )!;
    expect(resume.closest("[hidden]")).toBeNull();
    expect(host.querySelector("[hidden]")?.textContent).toContain("Check slope");
  });
});
