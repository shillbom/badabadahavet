import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Crosshair,
  CalendarDays,
  Camera,
  X,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import SwimMap from "@/components/SwimMap";
import { toast } from "@/components/ui/Toast";
import { createSession, findOrCreatePlace } from "@/lib/data";
import { isWinterMonth } from "@/lib/scoring";
import { haversineMeters } from "@/lib/utils";
import { PLACE_RADIUS_METERS } from "@/lib/scoring";
import type { SessionDoc } from "@/lib/types";

type Mode = "now" | "pick";

export default function LogSessionPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const places = useStore((s) => s.places);
  const allSessions = useStore((s) => s.allSessions);

  const [mode, setMode] = useState<Mode>("now");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => toLocalInput(new Date()));
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  // Suggest a place name when the user clicks near a known one.
  const suggestion = useMemo(() => {
    if (!coords) return null;
    let best: { name: string; dist: number } | null = null;
    for (const p of places) {
      const d = haversineMeters(coords, p);
      if (d < PLACE_RADIUS_METERS && (!best || d < best.dist))
        best = { name: p.name, dist: d };
    }
    return best?.name ?? null;
  }, [coords, places]);

  useEffect(() => {
    if (mode === "now") {
      if (!navigator.geolocation) {
        toast.error("Geolocation not available");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => toast.error("Couldn't read your location — try Pick on map"),
        { enableHighAccuracy: true, timeout: 8000 },
      );
      setDate(toLocalInput(new Date()));
    }
  }, [mode]);

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  }

  function clearPhoto() {
    setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    if (photoInput.current) photoInput.current.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !profile) return;
    if (!coords) {
      toast.error("Need a location — tap the map or allow GPS.");
      return;
    }
    const finalName = (name || suggestion || "").trim();
    if (!finalName) {
      toast.error("Give the spot a name.");
      return;
    }
    const ts = new Date(date).getTime();
    if (Number.isNaN(ts)) {
      toast.error("That date doesn't look right.");
      return;
    }
    setBusy(true);
    try {
      const place = await findOrCreatePlace({
        name: finalName,
        lat: coords.lat,
        lng: coords.lng,
        createdBy: user.uid,
        date: ts,
      });
      const session = await createSession({
        uid: user.uid,
        displayName: profile.displayName,
        place,
        lat: coords.lat,
        lng: coords.lng,
        date: ts,
        note,
        photoFile,
      });
      toast.success(
        `+${session.points} pts${session.isUniqueForUser ? " · new spot!" : ""}${session.isWinter ? " · winter" : ""}`,
      );
      navigate("/history");
    } catch (err) {
      toast.error((err as Error).message ?? "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  const isWinter = isWinterMonth(new Date(date));
  const sessionsByPlace = useMemo(() => {
    const m = new Map<string, SessionDoc[]>();
    for (const s of allSessions) {
      const arr = m.get(s.placeId) ?? [];
      arr.push(s);
      m.set(s.placeId, arr);
    }
    return m;
  }, [allSessions]);

  return (
    <form onSubmit={submit} className="px-4 pb-10 pt-2">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="font-display text-xl font-black text-wave-900">
          Log a swim
        </h2>
        <span className="w-8" />
      </div>

      <div className="flex rounded-full bg-slate-100 p-1">
        <button
          type="button"
          data-active={mode === "now"}
          onClick={() => setMode("now")}
          className="pill-tab"
        >
          <Crosshair className="h-3.5 w-3.5" /> Here & now
        </button>
        <button
          type="button"
          data-active={mode === "pick"}
          onClick={() => setMode("pick")}
          className="pill-tab"
        >
          <CalendarDays className="h-3.5 w-3.5" /> Pick on map
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="mt-4 space-y-4"
        >
          <div className="h-[40vh] overflow-hidden rounded-2xl border border-white/60 shadow-sm">
            <SwimMap
              places={places}
              sessionsByPlace={sessionsByPlace}
              onPick={mode === "pick" ? (lat, lng) => setCoords({ lat, lng }) : undefined}
              pickedAt={coords}
            />
          </div>

          <div className="rounded-2xl bg-white/70 p-3 ring-1 ring-white/60">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <MapPin className="h-3.5 w-3.5 text-wave-600" />
              {coords ? (
                <span>
                  {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                  {suggestion ? (
                    <span className="ml-2 text-wave-700">
                      · near <strong>{suggestion}</strong>
                    </span>
                  ) : null}
                </span>
              ) : mode === "now" ? (
                <span>Reading your location…</span>
              ) : (
                <span>Tap the map to drop a pin.</span>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">Spot name</Label>
            <Input
              id="name"
              placeholder={suggestion ?? "e.g. Långholmen"}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="date">When</Label>
            <Input
              id="date"
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {isWinter ? (
              <div className="chip mt-1 bg-sky-100 text-sky-800 ring-sky-200">
                ❄️ Winter dip — +2 bonus
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea
              id="note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Cold, sunny, brave?"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Photo (optional)</Label>
            {photoPreview ? (
              <div className="relative overflow-hidden rounded-xl">
                <img
                  src={photoPreview}
                  alt=""
                  className="h-44 w-full object-cover"
                />
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"
                  aria-label="Remove photo"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white/60 py-6 text-sm text-slate-500 hover:bg-white/90"
              >
                <Camera className="h-4 w-4" />
                Add a photo
              </button>
            )}
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onPhotoChange}
            />
          </div>

          <Button type="submit" loading={busy} size="lg" className="w-full">
            Save swim <Sparkles className="h-4 w-4" />
          </Button>
        </motion.div>
      </AnimatePresence>
    </form>
  );
}

function toLocalInput(d: Date) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
