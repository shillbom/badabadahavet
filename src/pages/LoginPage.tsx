import { useState } from "react";
import { motion } from "framer-motion";
import { Waves, Sparkles } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function LoginPage() {
  const { login, signup } = useAuth();
  const t = useT();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim() || password.length < 4) {
      toast.error(t("auth.error.validation"));
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        await signup(handle, password);
        toast.success(t("auth.welcome", { name: handle.trim() }));
      } else {
        await login(handle, password);
        toast.success(t("auth.hello_again", { name: handle.trim() }));
      }
    } catch (err) {
      const msg = (err as Error).message ?? "";
      toast.error(prettyAuthError(msg, t));
    } finally {
      setBusy(false);
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
          <Label htmlFor="handle">{t("auth.name")}</Label>
          <Input
            id="handle"
            autoComplete="username"
            placeholder={t("auth.handle_placeholder")}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("auth.password")}</Label>
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
        <Button type="submit" loading={busy} size="lg" className="w-full">
          {mode === "signup" ? t("auth.create_account") : t("auth.dive_in")}
          <Sparkles className="h-4 w-4" />
        </Button>
        <p className="text-center text-[11px] text-slate-500">
          {t("auth.fun_disclaimer")}
        </p>
      </motion.form>
    </div>
  );
}

function prettyAuthError(msg: string, t: (k: string) => string) {
  if (msg.includes("invalid-credential") || msg.includes("wrong-password"))
    return t("auth.error.wrong_credentials");
  if (msg.includes("user-not-found")) return t("auth.error.user_not_found");
  if (msg.includes("email-already-in-use")) return t("auth.error.taken");
  if (msg.includes("weak-password")) return t("auth.error.weak_password");
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
