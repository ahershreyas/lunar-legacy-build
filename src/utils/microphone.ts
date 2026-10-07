/** Abort permission waits and release any stream granted after cancellation. */
export function requestMicrophone(signal: AbortSignal, timeoutMs = 12000): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error, stream?: MediaStream) => {
      if (finished) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(stream!);
    };
    const abort = () => finish(new Error("Microphone request cancelled. You can retry."));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "No microphone permission response from this preview. Open the app in your browser, allow its microphone, or type your mission.",
          ),
        ),
      timeoutMs,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(
        (s) => finish(undefined, s),
        (e) => {
          const denied =
            typeof e === "object" && e !== null && "name" in e && e.name === "NotAllowedError";
          finish(
            new Error(
              denied
                ? "Microphone access denied. Allow microphone access for this preview, then retry."
                : "Microphone unavailable. Check your input device and retry.",
            ),
          );
        },
      );
  });
}
