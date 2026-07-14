import { useEffect, useRef, useState } from "react";
import { m } from "framer-motion";
import { REACTION_EMOJIS, reactorUids, toggleReaction } from "@/lib/data";
import type { SessionDoc } from "@/lib/types";
import { useT } from "@/lib/i18n";

/**
 * Emoji reaction bar for a single swim. Shows the emojis that already have
 * reactors (with counts) and, for signed-in users, a "+" that expands an
 * inline emoji picker. The picker expands in normal flow (rather than as an
 * absolute popover) so it's never clipped inside a scrolling container like
 * the friends'-swims sheet. Reactions live on the session doc
 * (`reactions: Record<emoji, uid[]>`) and update via the same Firestore
 * snapshot the list/map renders from, so counts reflect immediately.
 */
export default function ReactionBar({
  session,
  myUid,
}: {
  session: SessionDoc;
  myUid?: string;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!showPicker) return;
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setShowPicker(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [showPicker]);

  const reactions = session.reactions ?? {};
  const activeEmojis = REACTION_EMOJIS.filter(
    (e) => reactorUids(reactions[e]).length > 0,
  );

  async function onToggle(emoji: string) {
    if (!myUid || pending) return;
    setPending(emoji);
    try {
      const hasReacted = reactorUids(reactions[emoji]).includes(myUid);
      await toggleReaction(session.id, emoji, myUid, hasReacted);
    } finally {
      setPending(null);
      setShowPicker(false);
    }
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {activeEmojis.map((emoji) => {
        const reactors = reactorUids(reactions[emoji]);
        const mine = !!myUid && reactors.includes(myUid);
        return (
          <m.button
            key={emoji}
            whileTap={{ scale: 0.85 }}
            disabled={!myUid || pending === emoji}
            onClick={() => onToggle(emoji)}
            aria-label={t("reactions.toggle", { emoji })}
            aria-pressed={mine}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 transition-colors ${
              mine
                ? "bg-wave-100 text-wave-800 ring-wave-400"
                : "bg-white/70 text-slate-600 ring-slate-200 hover:bg-slate-50"
            } ${pending === emoji ? "opacity-60" : ""}`}
          >
            <span>{emoji}</span>
            <span className="font-medium tabular-nums">{reactors.length}</span>
          </m.button>
        );
      })}

      {myUid ? (
        <div ref={wrapRef} className="flex items-center">
          {showPicker ? (
            <m.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.12 }}
              className="inline-flex items-center gap-0.5 rounded-full bg-white p-0.5 shadow-sm ring-1 ring-slate-200"
            >
              {REACTION_EMOJIS.map((emoji) => {
                const mine =
                  !!myUid && reactorUids(reactions[emoji]).includes(myUid);
                return (
                  <button
                    type="button"
                    key={emoji}
                    onClick={() => onToggle(emoji)}
                    aria-label={emoji}
                    aria-pressed={mine}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-lg transition-colors ${
                      mine ? "bg-wave-100" : "hover:bg-slate-100"
                    }`}
                  >
                    {emoji}
                  </button>
                );
              })}
            </m.div>
          ) : (
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              aria-label={t("reactions.add")}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-white/70 text-sm ring-1 ring-slate-200 hover:bg-slate-50"
            >
              +
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
