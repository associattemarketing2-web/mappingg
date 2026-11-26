"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/* ---------------- Live location ---------------- */
export type Loc = { lat: number; lng: number; accuracy: number };

export function useLiveLocation(active: boolean) {
  const [loc, setLoc] = useState<Loc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (!("geolocation" in navigator)) {
      setError("This device does not support location.");
      return;
    }
    setError(null);
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });
        setError(null);
      },
      (e) => {
        setError(
          e.code === 1
            ? "Location permission denied. Please allow location for this site in browser settings and turn on GPS."
            : e.code === 3
              ? "Location timed out. Move near a window / turn on GPS and retry."
              : "Unable to get location. Turn on GPS and retry.",
        );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active, tick]);

  return { loc, error, retry: () => setTick((t) => t + 1) };
}

/* ---------------- Selfie camera ---------------- */
export function SelfieCamera({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera not available. Open the app over HTTPS (or localhost) in Chrome/Safari.");
      return;
    }
    try {
      stop();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);
    } catch (e) {
      const name = (e as Error).name;
      setError(name === "NotAllowedError" ? "Camera permission denied. Please allow camera access in browser settings." : "Could not start camera: " + (e as Error).message);
    }
  }, [stop]);

  useEffect(() => {
    if (!value) start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const size = Math.min(v.videoWidth, v.videoHeight);
    const out = 480;
    const c = document.createElement("canvas");
    c.width = out;
    c.height = out;
    const ctx = c.getContext("2d")!;
    // mirror so it matches the preview, crop to square
    ctx.translate(out, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, (v.videoWidth - size) / 2, (v.videoHeight - size) / 2, size, size, 0, 0, out, out);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // timestamp watermark
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(0, out - 28, out, 28);
    ctx.fillStyle = "#fff";
    ctx.font = "14px sans-serif";
    ctx.fillText(new Date().toLocaleString("en-IN"), 10, out - 9);
    onChange(c.toDataURL("image/jpeg", 0.75));
    stop();
  }

  return (
    <div>
      <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl bg-slate-900">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="selfie" className="h-full w-full object-cover" />
        ) : (
          <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
        )}
        {!value && !ready && !error && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Starting camera…</div>}
        {error && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white">{error}</div>}
      </div>
      <div className="mt-3 flex justify-center gap-2">
        {value ? (
          <button type="button" className="btn-ghost" onClick={() => onChange(null)}>
            🔄 Retake
          </button>
        ) : error ? (
          <button type="button" className="btn-ghost" onClick={start}>
            Retry camera
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={capture} disabled={!ready}>
            📸 Click Selfie
          </button>
        )}
      </div>
    </div>
  );
}
