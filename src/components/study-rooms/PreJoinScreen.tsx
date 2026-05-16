// Device-check + permission-grant gate that runs BEFORE the user enters a
// MeetingRoom. Solves three concrete UX failures from the audit:
//   1. Silent permission denial (browser blocks camera → user sees a black
//      tile and no explanation).
//   2. No way to see/pick which mic or camera will be used.
//   3. No way to test audio levels before being heard by others.
//
// Persists last-used device IDs in localStorage so the next join is one click.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Mic, MicOff, Video, VideoOff, AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const DEVICE_PREF_KEY = "study-rooms:device-prefs:v1";

type PermissionState = "unknown" | "prompting" | "granted" | "denied";

type DevicePrefs = {
  cameraId?: string;
  micId?: string;
  videoOn: boolean;
  micOn: boolean;
};

function loadPrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(DEVICE_PREF_KEY);
    if (raw) return { videoOn: true, micOn: true, ...JSON.parse(raw) };
  } catch {}
  return { videoOn: true, micOn: true };
}

function savePrefs(p: DevicePrefs) {
  try { localStorage.setItem(DEVICE_PREF_KEY, JSON.stringify(p)); } catch {}
}

export interface PreJoinResult {
  cameraId?: string;
  micId?: string;
  videoOn: boolean;
  micOn: boolean;
}

interface PreJoinScreenProps {
  roomName: string;
  onJoin: (prefs: PreJoinResult) => void;
  onCancel: () => void;
}

export default function PreJoinScreen({ roomName, onJoin, onCancel }: PreJoinScreenProps) {
  const initialPrefs = loadPrefs();
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  // Tracks whether the saved cameraId/micId has been validated against the
  // actual device list. Before that, we never pass `deviceId: { exact: ... }`
  // because a stale id from another browser/device causes OverconstrainedError.
  const [devicesEnumerated, setDevicesEnumerated] = useState(false);
  const [cameraId, setCameraId] = useState<string | undefined>(initialPrefs.cameraId);
  const [micId, setMicId] = useState<string | undefined>(initialPrefs.micId);
  const [videoOn, setVideoOn] = useState(initialPrefs.videoOn);
  const [micOn, setMicOn] = useState(initialPrefs.micOn);
  const [audioLevel, setAudioLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRafRef = useRef<number | null>(null);

  // Callback ref so we can attach the active stream the moment the <video>
  // element is mounted by React. The previous implementation set
  // `videoElRef.current.srcObject` inside the async getUserMedia handler —
  // but the <video> only renders AFTER `permission === "granted"`, so on
  // the first mount videoElRef was still null when we tried to assign and
  // the preview stayed black.
  const setVideoEl = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  // Acquire the preview stream + the device list. Runs whenever the user
  // picks a different device, or toggles mic/video.
  useEffect(() => {
    let cancelled = false;
    setPermission((prev) => (prev === "granted" ? prev : "prompting"));

    const cleanupOldStream = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };

    // Only pin to a specific deviceId AFTER the device list has been
    // enumerated and the saved id is confirmed present. Otherwise a stale
    // localStorage id (from a different browser, a now-disconnected USB
    // camera, etc.) raises OverconstrainedError and the user sees "שגיאה
    // בגישה למצלמה" even though the hardware is fine.
    const canUseCameraId =
      cameraId && devicesEnumerated && cameras.some((c) => c.deviceId === cameraId);
    const canUseMicId =
      micId && devicesEnumerated && mics.some((m) => m.deviceId === micId);

    const constraints: MediaStreamConstraints = {
      video: videoOn ? (canUseCameraId ? { deviceId: { exact: cameraId } } : true) : false,
      audio: micOn ? (canUseMicId ? { deviceId: { exact: micId } } : true) : false,
    };

    (async () => {
      try {
        cleanupOldStream();

        if (!videoOn && !micOn) {
          // Both off — nothing to acquire, but we still need to render the
          // preview area. Skip the getUserMedia call.
          setPermission("granted");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        setPermission("granted");
        setPermissionError(null);

        // The video element may or may not be in the DOM at this point.
        // If it is, attach now. If not, the callback ref (`setVideoEl`)
        // will attach as soon as React mounts it.
        if (videoElRef.current) {
          videoElRef.current.srcObject = stream;
          videoElRef.current.play().catch(() => {});
        }

        // Audio meter — visualizes the mic input so the user knows it's live.
        if (micOn && stream.getAudioTracks().length > 0) {
          try {
            const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            const ctx = new AudioCtx();
            audioCtxRef.current = ctx;
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            src.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);

            const tick = () => {
              analyser.getByteFrequencyData(data);
              let sum = 0;
              for (let i = 0; i < data.length; i++) sum += data[i];
              const avg = sum / data.length;
              setAudioLevel(Math.min(100, (avg / 128) * 100));
              analyserRafRef.current = requestAnimationFrame(tick);
            };
            tick();
          } catch {
            // Visualizer is nice-to-have — don't block join on a failure.
          }
        }

        // Refresh device list once we have permission (labels are blank
        // before a permission grant).
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const videoDevices = devices.filter((d) => d.kind === "videoinput");
        const audioDevices = devices.filter((d) => d.kind === "audioinput");
        setCameras(videoDevices);
        setMics(audioDevices);
        // If the saved id is no longer present, drop it so the next picks
        // default to the active stream's actual device.
        if (cameraId && !videoDevices.some((c) => c.deviceId === cameraId)) {
          const activeVideo = stream.getVideoTracks()[0]?.getSettings().deviceId;
          setCameraId(activeVideo ?? undefined);
        }
        if (micId && !audioDevices.some((m) => m.deviceId === micId)) {
          const activeAudio = stream.getAudioTracks()[0]?.getSettings().deviceId;
          setMicId(activeAudio ?? undefined);
        }
        setDevicesEnumerated(true);
      } catch (err: unknown) {
        if (cancelled) return;
        cleanupOldStream();
        const name = (err as { name?: string })?.name ?? "";
        console.warn("[PreJoinScreen] getUserMedia failed:", name, err);

        // OverconstrainedError means our deviceId constraint was wrong —
        // retry with a relaxed constraint instead of giving up. Drop the
        // saved id so the dropdown defaults to the actual active device.
        if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
          setCameraId(undefined);
          setMicId(undefined);
          setDevicesEnumerated(false);
          // The state changes above will re-trigger this effect with `true`
          // constraints (no exact deviceId), which should succeed.
          return;
        }

        setPermission("denied");
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setPermissionError(
            "הדפדפן חסם גישה למצלמה/מיקרופון. יש להפעיל את ההרשאות בהגדרות האתר ולנסות שוב.",
          );
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          setPermissionError("לא נמצאו התקני מצלמה או מיקרופון פעילים במחשב זה.");
        } else if (name === "NotReadableError") {
          setPermissionError("המצלמה או המיקרופון בשימוש על-ידי תוכנה אחרת. יש לסגור אותה ולנסות שוב.");
        } else {
          setPermissionError(`שגיאה בגישה למצלמה או למיקרופון (${name || "לא ידוע"}).`);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (analyserRafRef.current) {
        cancelAnimationFrame(analyserRafRef.current);
        analyserRafRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [cameraId, micId, videoOn, micOn]);

  // Final teardown when the component unmounts (e.g. user clicked Join and
  // we navigated to MeetingRoom). MeetingRoom acquires its own stream — we
  // must release this one or the camera gets duplicated.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const handleJoin = () => {
    const prefs: DevicePrefs = { cameraId, micId, videoOn, micOn };
    savePrefs(prefs);
    onJoin(prefs);
  };

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center p-4">
      <Card className="w-full max-w-3xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{roomName}</CardTitle>
          <CardDescription>בדיקת מצלמה ומיקרופון לפני הכניסה</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Preview */}
          <div className="relative aspect-video rounded-xl overflow-hidden bg-black border border-border">
            {/* Always render the <video> so the callback ref can wire up
                the stream the instant it's available. Hide it via CSS when
                the camera is off / blocked. */}
            <video
              ref={setVideoEl}
              autoPlay
              playsInline
              muted
              className={
                "w-full h-full object-cover " +
                (videoOn && permission === "granted" ? "" : "invisible")
              }
              // Mirror the local preview so the user feels they're looking
              // in a mirror — standard for self-view.
              style={{ transform: "scaleX(-1)" }}
            />
            {(!videoOn || permission !== "granted") && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <VideoOff className="w-12 h-12" />
                <p className="text-sm">
                  {permission === "denied" ? "אין גישה למצלמה" : permission === "prompting" ? "מאתחל מצלמה…" : "המצלמה כבויה"}
                </p>
              </div>
            )}

            {/* Audio meter */}
            {micOn && permission === "granted" && (
              <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5">
                <Mic className="w-4 h-4 text-white shrink-0" />
                <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-100",
                      audioLevel > 60 ? "bg-red-500" : audioLevel > 20 ? "bg-green-500" : "bg-white/60",
                    )}
                    style={{ width: `${audioLevel}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Permission error */}
          {permission === "denied" && permissionError && (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertTitle>אין גישה למצלמה/מיקרופון</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{permissionError}</p>
                <p className="text-xs">
                  בכרום: יש ללחוץ על סמל המנעול ליד הכתובת ולאפשר מצלמה ומיקרופון, ואז לרענן את הדף.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* Controls */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">מצלמה</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={videoOn ? "default" : "outline"}
                  size="icon"
                  onClick={() => setVideoOn((v) => !v)}
                  aria-label={videoOn ? "כיבוי מצלמה" : "הפעלת מצלמה"}
                >
                  {videoOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                </Button>
                <Select
                  value={cameraId}
                  onValueChange={(v) => setCameraId(v)}
                  disabled={!videoOn || permission !== "granted"}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="בחירת מצלמה" />
                  </SelectTrigger>
                  <SelectContent>
                    {cameras.map((c) => (
                      <SelectItem key={c.deviceId} value={c.deviceId}>
                        {c.label || `מצלמה ${c.deviceId.slice(0, 6)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">מיקרופון</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={micOn ? "default" : "outline"}
                  size="icon"
                  onClick={() => setMicOn((v) => !v)}
                  aria-label={micOn ? "השתקת מיקרופון" : "ביטול השתקה"}
                >
                  {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </Button>
                <Select
                  value={micId}
                  onValueChange={(v) => setMicId(v)}
                  disabled={!micOn || permission !== "granted"}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="בחירת מיקרופון" />
                  </SelectTrigger>
                  <SelectContent>
                    {mics.map((m) => (
                      <SelectItem key={m.deviceId} value={m.deviceId}>
                        {m.label || `מיקרופון ${m.deviceId.slice(0, 6)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              ביטול
            </Button>
            <Button
              type="button"
              onClick={handleJoin}
              disabled={permission === "prompting"}
              className="min-w-[140px]"
            >
              {permission === "denied" ? "כניסה בלי גישה" : "כניסה לחדר"}
              <ArrowRight className="w-4 h-4 ms-2 rtl:rotate-180" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
