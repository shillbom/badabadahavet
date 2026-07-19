import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Camera, MapPin, Trash2, X } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import BackButton from "@/components/ui/BackButton";
import Photo from "@/components/Photo";
import { toast } from "@/components/ui/toastStore";
import { removeSession, updateSession, type SessionEdits } from "@/lib/data";
import { checkImageFile, ImageProcessingError } from "@/lib/image";
import { assertTextAllowed, ModerationError } from "@/lib/moderation";
import {
  currentSeasonStart,
  currentYear,
  isWinterMonth,
  previewPoints,
  swimYear,
} from "@/lib/scoring";
import { useLocale, useT } from "@/lib/i18n";

/** The photo edit state: keep what's stored, remove it, or replace it. */
type PhotoEdit =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "replace"; file: File; preview: string };

/**
 * Edit one of the user's own swims: the date/time, the note, and the photo
 * are editable (the place is fixed — log a new swim for a different spot).
 * The actual write goes through the `updateSession` Cloud Function, which
 * recomputes points/isWinter and the per-year score server-side. Deleting
 * the swim lives here too, instead of a bare delete button in the lists.
 */
export default function EditSwimPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const t = useT();
  // Same reason as LogSessionPage: the native datetime-local picker formats
  // from the input's own `lang`, not <html lang>.
  const locale = useLocale((s) => s.locale);
  const inputLang = locale === "sv" ? "sv-SE" : "en-GB";

  const mySessions = useStore((s) => s.mySessions);
  const session = mySessions.find((s) => s.id === sessionId);

  const [date, setDate] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [photoEdit, setPhotoEdit] = useState<PhotoEdit>({ kind: "keep" });
  const photoInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!session) {
    // Own sessions stream in via the store listener — right after a reload
    // the list may simply not have arrived yet, so spin instead of flashing
    // "not found" while it's plausibly still on its way.
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 px-4">
        {mySessions.length === 0 && user ? (
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-wave-600 border-r-transparent" />
        ) : (
          <>
            <p className="text-sm text-slate-500">{t("swim.edit.not_found")}</p>
            <BackButton />
          </>
        )}
      </div>
    );
  }

  // Uncontrolled-until-touched: fall back to the stored values so a
  // re-streamed session (e.g. a reaction landing) doesn't clobber edits.
  const dateValue = date ?? toLocalInput(new Date(session.date));
  const noteValue = note ?? session.note ?? "";
  // Past seasons are locked: a swim from a previous year can no longer be
  // edited or deleted (the updateSession/removeSession functions enforce this
  // too — this just keeps the UI honest).
  const locked = swimYear(session.date) < currentYear();

  const parsedDate = new Date(dateValue).getTime();
  const isWinterSwim =
    !Number.isNaN(parsedDate) && isWinterMonth(new Date(parsedDate));
  const pointsPreview = previewPoints({
    isNewSpot: session.isUniqueForUser,
    isWinter: isWinterSwim,
  });

  const currentPhotoUrl =
    photoEdit.kind === "replace"
      ? photoEdit.preview
      : photoEdit.kind === "keep"
        ? (session.photoUrl ?? null)
        : null;

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    // Reject oversized / unsupported images right away — same pre-check as
    // logging a swim.
    const reason = await checkImageFile(f);
    if (reason) {
      toast.error(
        t(
          reason === "too-large"
            ? "log.error.image_too_large"
            : "log.error.image_failed",
        ),
      );
      if (photoInput.current) photoInput.current.value = "";
      return;
    }
    setPhotoEdit((prev) => {
      if (prev.kind === "replace") URL.revokeObjectURL(prev.preview);
      return { kind: "replace", file: f, preview: URL.createObjectURL(f) };
    });
  }

  function clearPhoto() {
    setPhotoEdit((prev) => {
      if (prev.kind === "replace") {
        URL.revokeObjectURL(prev.preview);
        // Removing a just-picked file falls back to the stored photo (if
        // any) — removing the stored photo is the explicit "remove" state.
        return session?.photoUrl ? { kind: "keep" } : { kind: "remove" };
      }
      return { kind: "remove" };
    });
    if (photoInput.current) photoInput.current.value = "";
  }

  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session) return;
    if (locked) return;
    const ts = new Date(dateValue).getTime();
    if (Number.isNaN(ts)) {
      toast.error(t("log.error.date"));
      return;
    }

    const edits: SessionEdits = {};
    if (ts !== session.date) edits.date = ts;
    const trimmedNote = noteValue.trim();
    if (trimmedNote !== (session.note ?? "")) {
      edits.note = trimmedNote || null;
    }
    if (photoEdit.kind === "remove" && session.photoUrl) edits.photoFile = null;
    else if (photoEdit.kind === "replace") edits.photoFile = photoEdit.file;

    if (Object.keys(edits).length === 0) {
      navigate(-1);
      return;
    }

    setBusy(true);
    try {
      // UX pre-check before the (potentially slow) photo upload — the
      // function re-checks the note authoritatively anyway.
      if (edits.note) await assertTextAllowed(edits.note);
      await updateSession(session, edits);
      toast.success(t("swim.edit.saved"));
      navigate(-1);
      return;
    } catch (err) {
      if (err instanceof ImageProcessingError) {
        toast.error(
          t(
            err.reason === "too-large"
              ? "log.error.image_too_large"
              : "log.error.image_failed",
          ),
        );
      } else if (err instanceof ModerationError) {
        toast.error(t("moderation.text_rejected"));
      } else {
        toast.error(t("swim.edit.error"));
      }
    }
    setBusy(false);
  }

  async function onDelete() {
    if (!session) return;
    if (locked) return;
    if (!window.confirm(t("swim.edit.delete_confirm"))) return;
    setDeleting(true);
    try {
      await removeSession(session.id);
      toast.success(t("swim.edit.deleted"));
      navigate(-1);
      return;
    } catch {
      toast.error(t("swim.edit.delete_error"));
    }
    setDeleting(false);
  }

  return (
    <form onSubmit={submit} className="px-4 pt-2 pb-10">
      <div className="mb-3 flex items-center justify-between">
        <BackButton />
        <h2 className="font-display text-xl font-black text-wave-900">
          {t("swim.edit.title")}
        </h2>
        <span className="w-8" />
      </div>

      <div className="space-y-4">
        {locked ? (
          <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
            {t("swim.edit.locked_year")}
          </div>
        ) : null}
        <div className="rounded-2xl bg-white/70 p-3 ring-1 ring-white/60">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-wave-600" />
            <span className="truncate font-semibold text-wave-900">
              {session.placeName}
            </span>
          </div>
          <p className="mt-1 pl-[22px] text-[11px] text-slate-500">
            {t("swim.edit.place_hint")}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="date">{t("log.field.when")}</Label>
          <Input
            id="date"
            type="datetime-local"
            lang={inputLang}
            value={dateValue}
            min={toLocalInput(new Date(currentSeasonStart()))}
            max={toLocalInput(new Date())}
            disabled={locked}
            onChange={(e) => setDate(e.target.value)}
          />
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <div className="chip bg-wave-100 text-wave-800 ring-wave-200">
              💧 {t("log.points.swim")}
            </div>
            {session.isUniqueForUser ? (
              <div className="chip bg-emerald-100 text-emerald-800 ring-emerald-200">
                ✨ {t("log.points.new_spot")}
              </div>
            ) : null}
            {isWinterSwim ? (
              <div className="chip bg-sky-100 text-sky-800 ring-sky-200">
                ❄️ {t("log.points.winter")}
              </div>
            ) : null}
            <span className="ml-auto font-display text-sm font-black text-wave-700">
              {t("log.points.total", { n: pointsPreview })}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="note">{t("log.field.note")}</Label>
          <Textarea
            id="note"
            rows={2}
            value={noteValue}
            disabled={locked}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("log.field.note.placeholder")}
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t("log.field.photo")}</Label>
          {currentPhotoUrl ? (
            <div className="relative overflow-hidden rounded-xl">
              {photoEdit.kind === "keep" ? (
                <Photo
                  src={currentPhotoUrl}
                  thumb={session.photoThumb}
                  className="h-44 w-full"
                  imgClassName="object-cover"
                />
              ) : (
                <img
                  src={currentPhotoUrl}
                  alt=""
                  className="h-44 w-full object-cover"
                />
              )}
              <button
                type="button"
                onClick={clearPhoto}
                className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white"
                aria-label={t("log.remove_photo")}
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
              {t("log.add_photo")}
            </button>
          )}
          {/* No `capture` attribute — see LogSessionPage: leaving it off lets
              mobile users choose the photo library OR take a new photo. */}
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPhotoChange}
          />
        </div>

        <Button
          type="submit"
          loading={busy}
          disabled={locked}
          size="lg"
          className="w-full"
        >
          {t("swim.edit.save")}
        </Button>

        <div className="pt-2 text-center">
          <button
            type="button"
            disabled={busy || deleting || locked}
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-60"
          >
            {deleting ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {t("swim.edit.delete")}
          </button>
        </div>
      </div>
    </form>
  );
}

const pad = (n: number) => n.toString().padStart(2, "0");

function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
