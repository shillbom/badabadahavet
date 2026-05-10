import { useState } from "react";
import { motion } from "framer-motion";
import { Waves, Sparkles } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";

export default function LoginPage() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim() || password.length < 4) {
      toast.error("Pick a name and a password (min 4 chars)");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        await signup(handle, password);
        toast.success(`Welcome, ${handle.trim()}!`);
      } else {
        await login(handle, password);
        toast.success(`Hello again, ${handle.trim()}!`);
      }
    } catch (err) {
      const msg = (err as Error).message ?? "Something went wrong";
      toast.error(prettyAuthError(msg));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10">
      <Ripples />
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
          badabadahavet
        </h1>
        <p className="mt-1 text-sm text-wave-700">
          A friendly little swim-spot competition
        </p>
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
            Log in
          </button>
          <button
            type="button"
            data-active={mode === "signup"}
            onClick={() => setMode("signup")}
            className="pill-tab"
          >
            Sign up
          </button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="handle">Name</Label>
          <Input
            id="handle"
            autoComplete="username"
            placeholder="e.g. otter"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            placeholder="••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          loading={busy}
          size="lg"
          className="w-full"
        >
          {mode === "signup" ? "Create account" : "Dive in"}
          <Sparkles className="h-4 w-4" />
        </Button>
        <p className="text-center text-[11px] text-slate-500">
          Just for fun — please don't reuse a real password.
        </p>
      </motion.form>
    </div>
  );
}

function prettyAuthError(msg: string) {
  if (msg.includes("invalid-credential") || msg.includes("wrong-password"))
    return "Wrong name or password";
  if (msg.includes("user-not-found")) return "No swimmer with that name yet";
  if (msg.includes("email-already-in-use")) return "That name is taken";
  if (msg.includes("weak-password")) return "Pick a longer password";
  return "Couldn't sign you in";
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
