import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/firebase";
import { ensureUserDoc } from "@/lib/data";
import type { UserDoc } from "@/lib/types";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/firebase";

type AuthCtx = {
  user: User | null;
  profile: UserDoc | null;
  loading: boolean;
  login: (handle: string, password: string) => Promise<void>;
  signup: (handle: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

// Username-only "login" — convert handle to a stable fake email for Firebase Auth.
function handleToEmail(handle: string) {
  return `${handle.trim().toLowerCase()}@badabadahavet.local`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setLoading(false);
        return;
      }
      await ensureUserDoc(u.uid, u.displayName ?? "Swimmer");
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, "users", user.uid), (snap) => {
      setProfile(snap.exists() ? (snap.data() as UserDoc) : null);
    });
    return unsub;
  }, [user]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      profile,
      loading,
      login: async (handle, password) => {
        await signInWithEmailAndPassword(auth, handleToEmail(handle), password);
      },
      signup: async (handle, password) => {
        const cred = await createUserWithEmailAndPassword(
          auth,
          handleToEmail(handle),
          password,
        );
        await updateProfile(cred.user, { displayName: handle.trim() });
        await ensureUserDoc(cred.user.uid, handle.trim());
      },
      logout: async () => {
        await signOut(auth);
      },
    }),
    [user, profile, loading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
