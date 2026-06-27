import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { REACTION_EMOJIS, toggleReaction } from "@/lib/data";
import type { SessionDoc } from "@/lib/types";
import { useT } from "@/lib/i18n";

/**
 * Emoji reaction bar for a single swim. Shows the emojis that already have
 * reactors (with counts) and, for signed-in users, a "+" picker to add one.
 * Reactions live on the session doc (`reactions: Record<emoji, uid[]>`) and
 * update via the same Firestore snapshot the list/map is rendered from, so
 * counts reflect immediately. Used on the Spot page and the friends' swim list.
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
  const pickerRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!showPicker) return;
    function onOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setShowPicker(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [showPicker]);

  const reactions = session.reactions ?? {};
  const activeEmojis = REACTION_EMOJIS.filter(
    (e) => (reactions[e]?.length ?? 0) > 0,
  );

  async function onToggle(emoji: string) {
    if (!myUid || pending) return;
    setPending(emoji);
    try {
      await toggleReaction(session.id, emoji, myUid, reactions[emoji] ?? []);
    } finally {
      setPending(null);
      setShowPicker(false);
    }
  }

  return (
    <div className="relative mt-1.5 flex flex-wrap items-center gap-1">
      {activeEmojis.map((emoji) => {
        const reactors = reactions[emoji] ?? [];
        const mine = !!myUid && reactors.includes(myUid);
        return (
          <motion.button
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
          </motion.button>
        );
      })}

      {myUid ? (
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setShowPicker((v) => !v)}
            aria-label={t("reactions.add")}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-white/70 text-sm ring-1 ring-slate-200 hover:bg-slate-50"
          >
            +
          </button>
          <AnimatePresence>
            {showPicker ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 bottom-full z-10 mb-1 flex gap-1 rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-slate-100"
              >
                {REACTION_EMOJIS.map((emoji) => {
                  const mine =
                    !!myUid && (reactions[emoji] ?? []).includes(myUid);
                  return (
                    <button
                      key={emoji}
                      onClick={() => onToggle(emoji)}
                      aria-label={emoji}
                      aria-pressed={mine}
                      className={`flex h-8 w-8 items-center justify-center rounded-xl text-lg transition-colors ${
                        mine ? "bg-wave-100" : "hover:bg-slate-100"
                      }`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
    </div>
  );
}
