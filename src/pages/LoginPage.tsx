import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Lock, Mail, Sparkles, User, Waves, X } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { useLocale, useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  COUNTRIES,
  detectBrowserCountry,
  flagEmoji,
  pickerCodeFor,
} from "@/lib/countries";
import { reverseGeocodeCountry } from "@/lib/geocode";

export default function LoginPage() {
  const { login, signup, resetPassword } = useAuth();
  const t = useT();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const setLocale = useLocale((s) => s.setLocale);
  const [homeCountry, setHomeCountryState] = useState<string>(() =>
    pickerCodeFor(detectBrowserCountry()),
  );
  const [homeCountryTouched, setHomeCountryTouched] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  function setHomeCountry(code: string, fromUser: boolean) {
    setHomeCountryState(code);
    if (fromUser) setHomeCountryTouched(true);
    // Auto-pair the locale: SE → Swedish, anything else → English.
    setLocale(code === "SE" ? "sv" : "en");
  }

  // Ask for geolocation immediately on mount (not just in signup mode)
  // so we can flip the UI to the user's likely language before they've
  // even touched the form. Manual changes still win.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const real = await reverseGeocodeCountry(
          pos.coords.latitude,
          pos.coords.longitude,
        );
        if (cancelled || homeCountryTouched) return;
        const code = pickerCodeFor(real);
        setHomeCountry(code, false);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      toast.error(t("auth.error.email_invalid"));
      return;
    }
    if (password.length < 6) {
      toast.error(t("auth.error.weak_password"));
      return;
    }
    if (mode === "signup" && !displayName.trim()) {
      toast.error(t("auth.error.name_required"));
      return;
    }
    if (mode === "signup" && !acceptedTerms) {
      toast.error(t("auth.error.terms_required"));
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        await signup(trimmedEmail, password, displayName, homeCountry);
        toast.success(t("auth.welcome", { name: displayName.trim() }));
      } else {
        await login(trimmedEmail, password);
        toast.success(t("auth.hello_again"));
      }
    } catch (err) {
      const msg = (err as Error).message ?? "";
      toast.error(prettyAuthError(msg, t));
    } finally {
      setBusy(false);
    }
  }

  async function onForgot() {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      toast.error(t("auth.error.email_invalid"));
      return;
    }
    try {
      await resetPassword(trimmed);
      toast.success(t("auth.reset_sent"));
    } catch (err) {
      const msg = (err as Error).message ?? "";
      toast.error(prettyAuthError(msg, t));
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10">
      <Ripples />
      <div className="absolute right-3 top-[max(env(safe-area-inset-top),0.75rem)] z-10">
        <LanguageSwitcher />
      </div>
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
        className="z-10 flex flex-col items-center"
      >
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-wave-600 text-white shadow-lg shadow-wave-700/30 animate-bob">
          <Waves className="h-8 w-8" />
        </div>
        <h1 className="font-display text-4xl font-black text-wave-900">
          {t("app.name")}
        </h1>
        <p className="mt-1 text-sm text-wave-700">{t("app.tagline")}</p>
      </motion.div>

      <motion.form
        onSubmit={submit}
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.05, type: "spring", stiffness: 200, damping: 22 }}
        className="z-10 mt-8 w-full max-w-sm space-y-4 glass p-5"
      >
        <div className="flex rounded-full bg-slate-100 p-1">
          <button
            type="button"
            data-active={mode === "login"}
            onClick={() => setMode("login")}
            className="pill-tab"
          >
            {t("auth.login")}
          </button>
          <button
            type="button"
            data-active={mode === "signup"}
            onClick={() => setMode("signup")}
            className="pill-tab"
          >
            {t("auth.signup")}
          </button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> {t("auth.email")}
            </span>
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t("auth.email_placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {mode === "signup" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="name">
                <span className="inline-flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" /> {t("auth.name")}
                </span>
              </Label>
              <Input
                id="name"
                autoComplete="nickname"
                placeholder={t("auth.handle_placeholder")}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="home-country">
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" /> {t("auth.home_country")}
                </span>
              </Label>
              <select
                id="home-country"
                value={homeCountry}
                onChange={(e) => setHomeCountry(e.target.value, true)}
                className="w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm shadow-sm focus:border-wave-400 focus:outline-none focus:ring-2 focus:ring-wave-200"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {flagEmoji(c.code)} {c.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500">
                {t("auth.home_country.hint")}
              </p>
            </div>
          </>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="password">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> {t("auth.password")}
            </span>
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            placeholder={t("auth.password_placeholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {mode === "signup" ? (
          <label className="flex items-start gap-2 text-[12px] text-slate-600">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none rounded border-slate-300 text-wave-600 focus:ring-wave-400"
            />
            <span>
              {t("auth.terms.prefix")}{" "}
              <button
                type="button"
                onClick={() => setTermsOpen(true)}
                className="font-semibold text-wave-700 underline hover:text-wave-800"
              >
                {t("auth.terms.link")}
              </button>
              .
            </span>
          </label>
        ) : null}

        <Button
          type="submit"
          loading={busy}
          size="lg"
          className="w-full"
          disabled={mode === "signup" && !acceptedTerms}
        >
          {mode === "signup" ? t("auth.create_account") : t("auth.dive_in")}
          <Sparkles className="h-4 w-4" />
        </Button>

        {mode === "login" ? (
          <button
            type="button"
            onClick={onForgot}
            className="block w-full text-center text-[11px] font-semibold text-wave-700 hover:underline"
          >
            {t("auth.forgot")}
          </button>
        ) : (
          <p className="rounded-xl bg-wave-50 px-3 py-2 text-center text-[11px] leading-snug text-wave-800 ring-1 ring-wave-200">
            🔒 {t("auth.privacy_note")}
          </p>
        )}
      </motion.form>

      <AnimatePresence>
        {termsOpen ? (
          <motion.div
            key="terms-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setTermsOpen(false)}
            className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4"
          >
            <motion.div
              key="terms-modal"
              initial={{ y: 16, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 16, opacity: 0, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h3 className="font-display text-lg font-bold text-wave-900">
                  {t("terms.title")}
                </h3>
                <button
                  type="button"
                  onClick={() => setTermsOpen(false)}
                  className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
                  aria-label={t("common.close")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto px-4 py-3 text-sm leading-relaxed text-slate-700">
                <p className="mb-3">{t("terms.intro")}</p>
                <ul className="space-y-2 list-disc pl-5">
                  <li>{t("terms.cookies")}</li>
                  <li>{t("terms.email")}</li>
                  <li>{t("terms.storage")}</li>
                  <li>{t("terms.content")}</li>
                  <li>{t("terms.safety")}</li>
                  <li>{t("terms.delete")}</li>
                  <li>{t("terms.fun")}</li>
                </ul>
              </div>
              <div className="border-t border-slate-200 px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setAcceptedTerms(true);
                    setTermsOpen(false);
                  }}
                  className="w-full rounded-xl bg-wave-600 px-3 py-2 text-sm font-bold text-white shadow hover:bg-wave-700"
                >
                  {t("terms.accept")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function prettyAuthError(msg: string, t: (k: string) => string) {
  if (msg.includes("invalid-credential") || msg.includes("wrong-password"))
    return t("auth.error.wrong_credentials");
  if (msg.includes("user-not-found")) return t("auth.error.user_not_found");
  if (msg.includes("email-already-in-use")) return t("auth.error.taken");
  if (msg.includes("weak-password")) return t("auth.error.weak_password");
  if (msg.includes("invalid-email")) return t("auth.error.email_invalid");
  return t("auth.error.generic");
}

function Ripples() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/3 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-wave-300/60 animate-ripple"
          style={{ animationDelay: `${i * 0.6}s` }}
        />
      ))}
    </div>
  );
}
