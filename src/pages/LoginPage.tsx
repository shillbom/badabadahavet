import { useEffect, useReducer, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import {
  Globe,
  Info,
  Lock,
  Mail,
  Sparkles,
  User,
  WavesArrowDown,
  X,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { Input, Label } from "@/components/ui/Input";
import { toast } from "@/components/ui/toastStore";
import { useLocale, useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  COUNTRIES,
  detectBrowserCountry,
  flagEmoji,
  pickerCodeFor,
} from "@/lib/countries";
import { reverseGeocodeCountry } from "@/lib/geocode";
import { assertTextAllowed, ModerationError } from "@/lib/moderation";
import { assertUsernameClean } from "@/lib/username";
import { consumeReturnPath } from "@/lib/utils";

type Translate = (k: string, vars?: Record<string, string>) => string;

// All auth-page state, effects, and handlers live here so the page component
// stays a thin composition of views. React Compiler handles memoization; the
// hook deliberately avoids useMemo/useCallback.
function useAuthForm() {
  const {
    login,
    signup,
    loginWithGoogle,
    completeGoogleOnboarding,
    googleOnboarding,
    user,
    resetPassword,
  } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [displayNameEdited, setDisplayNameEdited] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const setLocale = useLocale((s) => s.setLocale);
  const [homeCountry, dispatchHomeCountry] = useReducer(
    (_current: string, next: string) => next,
    pickerCodeFor(detectBrowserCountry()),
  );
  const homeCountryTouchedRef = useRef(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  function setHomeCountry(code: string, fromUser: boolean) {
    dispatchHomeCountry(code);
    if (fromUser) homeCountryTouchedRef.current = true;
    // Auto-pair the locale: SE → Swedish, anything else → English.
    setLocale(code === "SE" ? "sv" : "en");
  }

  // Until the user edits it, Google onboarding displays the account name
  // directly. This avoids copying a prop into state in an effect.
  const onboardingDisplayName = displayNameEdited
    ? displayName
    : (user?.displayName ?? "");

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
        if (cancelled || homeCountryTouchedRef.current) return;
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

  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
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
        // Check the name before creating the auth account, so a rejected
        // name doesn't leave a half-onboarded user behind. The wordlist
        // check runs first — instant and offline — before the Perspective
        // call, which fails open on network errors.
        await assertUsernameClean(displayName);
        await assertTextAllowed(displayName);
        await signup(trimmedEmail, password, displayName, homeCountry);
        toast.success(t("auth.welcome", { name: displayName.trim() }));
      } else {
        await login(trimmedEmail, password);
        toast.success(t("auth.hello_again"));
      }
      // Return the user to wherever they came from (e.g. /spot/abc).
      navigate(consumeReturnPath(), { replace: true });
    } catch (err) {
      if (err instanceof ModerationError) {
        toast.error(t("moderation.name_rejected"));
      } else {
        const msg = (err as Error).message ?? "";
        toast.error(prettyAuthError(msg, t));
      }
    }
    setBusy(false);
  }

  async function onGoogleSignIn() {
    setBusy(true);
    try {
      await loginWithGoogle();
      // Page navigates away — busy state stays set intentionally.
    } catch (err) {
      const msg = (err as Error).message ?? "";
      toast.error(prettyAuthError(msg, t));
      setBusy(false);
    }
  }

  async function onCompleteOnboarding(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acceptedTerms) {
      toast.error(t("auth.error.terms_required"));
      return;
    }
    setBusy(true);
    try {
      // Only a name the user typed themselves needs checking — the
      // fallback is the Google account name.
      if (onboardingDisplayName.trim()) {
        await assertUsernameClean(onboardingDisplayName);
        await assertTextAllowed(onboardingDisplayName);
      }
      await completeGoogleOnboarding(onboardingDisplayName, homeCountry);
      toast.success(
        t("auth.welcome", {
          name: onboardingDisplayName.trim(),
        }),
      );
      navigate(consumeReturnPath(), { replace: true });
    } catch (err) {
      if (err instanceof ModerationError) {
        toast.error(t("moderation.name_rejected"));
      } else {
        console.error("completeGoogleOnboarding error:", err);
        const msg = (err as Error).message ?? "";
        toast.error(prettyAuthError(msg, t));
      }
    }
    setBusy(false);
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

  return {
    t,
    navigate,
    mode,
    setMode,
    email,
    setEmail,
    displayName,
    setDisplayName,
    setDisplayNameEdited,
    password,
    setPassword,
    busy,
    homeCountry,
    setHomeCountry,
    acceptedTerms,
    setAcceptedTerms,
    termsOpen,
    setTermsOpen,
    googleOnboarding,
    onboardingDisplayName,
    submit,
    onGoogleSignIn,
    onCompleteOnboarding,
    onForgot,
  };
}

export default function LoginPage() {
  const form = useAuthForm();

  if (form.googleOnboarding) {
    return <OnboardingView form={form} />;
  }

  return <LoginView form={form} />;
}

type FormState = ReturnType<typeof useAuthForm>;

// Shared header: logo, app name, and a tagline/subtitle line.
function AuthHeader({ subtitle }: { subtitle: string }) {
  const t = useT();
  return (
    <m.div
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}
      className="z-10 flex flex-col items-center"
    >
      <img
        src="/web-app-manifest-192x192.png"
        alt="Badligan"
        width="80"
        height="80"
        className="mb-3 h-20 w-20 animate-bob rounded-2xl shadow-lg shadow-wave-700/30"
      />
      <h1 className="font-display text-4xl font-black text-wave-900">
        {t("app.name")}
      </h1>
      <p className="mt-1 text-sm text-wave-700">{subtitle}</p>
    </m.div>
  );
}

// Top-right controls (About link + language switcher), shared by both views.
function TopBar() {
  const navigate = useNavigate();
  const t = useT();
  return (
    <div className="absolute top-[max(env(safe-area-inset-top),0.75rem)] right-3 z-10 flex items-center gap-2">
      <button
        type="button"
        onClick={() => navigate("/about")}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-wave-700 ring-1 ring-wave-200 backdrop-blur-sm hover:bg-white"
        aria-label={t("nav.about")}
      >
        <Info className="h-4 w-4" />
      </button>
      <LanguageSwitcher />
    </div>
  );
}

// Country <select> reused by signup and onboarding; the hint copy differs.
function CountryPicker({
  id,
  value,
  onChange,
  hint,
}: {
  id: string;
  value: string;
  onChange: (code: string) => void;
  hint: string;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        <span className="inline-flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" /> {t("auth.home_country")}
        </span>
      </Label>
      <select
        id={id}
        aria-label={t("auth.home_country")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm shadow-sm focus:border-wave-400 focus:ring-2 focus:ring-wave-200 focus:outline-none"
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {flagEmoji(c.code)} {c.name}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

// Terms checkbox + inline "read the terms" trigger, shared by both forms.
function TermsCheckbox({
  accepted,
  onToggle,
  onOpen,
}: {
  accepted: boolean;
  onToggle: (checked: boolean) => void;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <label className="flex items-start gap-2 text-[12px] text-slate-600">
      <input
        type="checkbox"
        checked={accepted}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-none rounded border-slate-300 text-wave-600 focus:ring-wave-400"
      />
      <span>
        {t("auth.terms.prefix")}{" "}
        <button
          type="button"
          onClick={onOpen}
          className="font-semibold text-wave-700 underline hover:text-wave-800"
        >
          {t("auth.terms.link")}
        </button>
        .
      </span>
    </label>
  );
}

// Google onboarding step for accounts that lack a homeCountry.
function OnboardingView({ form }: { form: FormState }) {
  const { t } = form;
  return (
    <div className="relative flex min-h-[var(--app-height,100dvh)] flex-col items-center justify-center px-5 py-10">
      <Ripples />
      <TopBar />
      <AuthHeader subtitle={t("auth.google.onboarding.title")} />

      <m.form
        onSubmit={form.onCompleteOnboarding}
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{
          delay: 0.05,
          type: "spring",
          stiffness: 200,
          damping: 22,
        }}
        className="glass z-10 mt-8 w-full max-w-sm space-y-4 p-5"
      >
        <div className="space-y-1.5">
          <Label htmlFor="ob-name">
            <span className="inline-flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />{" "}
              {t("auth.google.onboarding.name")}
            </span>
          </Label>
          <Input
            id="ob-name"
            autoComplete="nickname"
            placeholder={t("auth.handle_placeholder")}
            value={form.onboardingDisplayName}
            onChange={(e) => {
              form.setDisplayNameEdited(true);
              form.setDisplayName(e.target.value);
            }}
          />
        </div>

        <CountryPicker
          id="ob-country"
          value={form.homeCountry}
          onChange={(code) => form.setHomeCountry(code, true)}
          hint={t("auth.google.onboarding.hint")}
        />

        <TermsCheckbox
          accepted={form.acceptedTerms}
          onToggle={form.setAcceptedTerms}
          onOpen={() => form.setTermsOpen(true)}
        />

        <Button
          type="submit"
          loading={form.busy}
          size="lg"
          className="w-full"
          disabled={!form.acceptedTerms}
        >
          {t("auth.google.onboarding.submit")}
          <Sparkles className="h-4 w-4" />
        </Button>
      </m.form>

      <AnimatePresence>
        {form.termsOpen ? (
          <TermsModal
            t={t}
            onAccept={() => {
              form.setAcceptedTerms(true);
              form.setTermsOpen(false);
            }}
            onClose={() => form.setTermsOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// Email/password login + signup form, with the Google sign-in option.
function LoginView({ form }: { form: FormState }) {
  const { t } = form;
  return (
    <div className="relative flex min-h-[var(--app-height,100dvh)] flex-col items-center justify-center px-5 py-10">
      <Ripples />
      <TopBar />
      <AuthHeader subtitle={t("app.tagline")} />

      <m.form
        onSubmit={form.submit}
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{
          delay: 0.05,
          type: "spring",
          stiffness: 200,
          damping: 22,
        }}
        className="glass z-10 mt-8 w-full max-w-sm space-y-4 p-5"
      >
        <SegmentedControl
          value={form.mode}
          onChange={form.setMode}
          options={[
            { value: "login", label: t("auth.login") },
            { value: "signup", label: t("auth.signup") },
          ]}
        />

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
            value={form.email}
            onChange={(e) => form.setEmail(e.target.value)}
          />
        </div>

        {form.mode === "signup" ? (
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
                value={form.displayName}
                onChange={(e) => form.setDisplayName(e.target.value)}
              />
            </div>
            <CountryPicker
              id="home-country"
              value={form.homeCountry}
              onChange={(code) => form.setHomeCountry(code, true)}
              hint={t("auth.home_country.hint")}
            />
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
              form.mode === "signup" ? "new-password" : "current-password"
            }
            placeholder={t("auth.password_placeholder")}
            value={form.password}
            onChange={(e) => form.setPassword(e.target.value)}
          />
        </div>

        {form.mode === "signup" ? (
          <TermsCheckbox
            accepted={form.acceptedTerms}
            onToggle={form.setAcceptedTerms}
            onOpen={() => form.setTermsOpen(true)}
          />
        ) : null}

        <Button
          type="submit"
          loading={form.busy}
          size="lg"
          className="w-full"
          disabled={form.mode === "signup" && !form.acceptedTerms}
        >
          {form.mode === "signup"
            ? t("auth.create_account")
            : t("auth.dive_in")}
          {form.mode === "signup" ? (
            <Sparkles className="h-4 w-4" />
          ) : (
            <WavesArrowDown className="h-4 w-4" />
          )}
        </Button>

        {form.mode === "login" ? (
          <button
            type="button"
            onClick={form.onForgot}
            className="block w-full text-center text-[11px] font-semibold text-wave-700 hover:underline"
          >
            {t("auth.forgot")}
          </button>
        ) : (
          <p className="rounded-xl bg-wave-50 px-3 py-2 text-center text-[11px] leading-snug text-wave-800 ring-1 ring-wave-200">
            🔒 {t("auth.privacy_note")}{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-wave-700 underline hover:text-wave-800"
            >
              {t("auth.privacy_link")}
            </a>
          </p>
        )}

        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-[11px] text-slate-400">
            {t("auth.google.divider")}
          </span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <button
          type="button"
          onClick={form.onGoogleSignIn}
          disabled={form.busy}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50"
        >
          <GoogleIcon />
          {t("auth.google")}
        </button>

        <button
          type="button"
          onClick={() => {
            // User chose to skip login — drop any pending return path so a
            // later sign-in doesn't surprise them by jumping back.
            try {
              sessionStorage.removeItem("login.returnTo");
            } catch {
              /* ignore */
            }
            form.navigate("/");
          }}
          className="block w-full text-center text-[12px] font-semibold text-wave-700 hover:underline"
        >
          {t("auth.browse_as_guest")}
        </button>
      </m.form>

      <AnimatePresence>
        {form.termsOpen ? (
          <TermsModal
            t={t}
            onAccept={() => {
              form.setAcceptedTerms(true);
              form.setTermsOpen(false);
            }}
            onClose={() => form.setTermsOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function prettyAuthError(msg: string, t: Translate) {
  if (msg.includes("invalid-credential") || msg.includes("wrong-password"))
    return t("auth.error.wrong_credentials");
  if (msg.includes("user-not-found")) return t("auth.error.user_not_found");
  if (msg.includes("email-already-in-use")) return t("auth.error.taken");
  if (msg.includes("weak-password")) return t("auth.error.weak_password");
  if (msg.includes("invalid-email")) return t("auth.error.email_invalid");
  return t("auth.error.generic");
}

function TermsModal({
  t,
  onAccept,
  onClose,
}: {
  t: Translate;
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <m.div
      key="terms-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm"
    >
      <m.div
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
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3 text-sm leading-relaxed text-slate-700">
          <p className="mb-3">{t("terms.intro")}</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>{t("terms.cookies")}</li>
            <li>{t("terms.email")}</li>
            <li>{t("terms.storage")}</li>
            <li>{t("terms.data")}</li>
            <li>{t("terms.content")}</li>
            <li>{t("terms.safety")}</li>
            <li>{t("terms.delete")}</li>
            <li>{t("terms.fun")}</li>
          </ul>
        </div>
        <div className="border-t border-slate-200 px-4 py-3">
          <Button type="button" onClick={onAccept} className="w-full">
            {t("terms.accept")}
          </Button>
        </div>
      </m.div>
    </m.div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function Ripples() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute top-1/3 left-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 animate-ripple rounded-full border border-wave-300/60"
          style={{ animationDelay: `${i * 0.6}s` }}
        />
      ))}
    </div>
  );
}
