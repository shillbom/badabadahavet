import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  deleteUser,
  type User,
} from "firebase/auth";
import { auth } from "@/firebase";
import { deleteAccountData, ensureUserDoc, setupUserDoc } from "@/lib/data";
import type { UserDoc } from "@/lib/types";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/firebase";
import { useLocale } from "@/lib/i18n";

type AuthCtx = {
  user: User | null;
  profile: UserDoc | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (
    email: string,
    password: string,
    displayName: string,
    homeCountry: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  // While signup is writing the freshly-created auth user's profile,
  // the auth-state listener must NOT create a parallel half-baked doc.
  const signupInFlight = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setLoading(false);
        return;
      }
      if (signupInFlight.current) {
        // signup() is authoritative for the new doc; just wait for the
        // onSnapshot subscription below to pick it up.
        return;
      }
      const doc = await ensureUserDoc(u.uid, u.displayName ?? "Swimmer");
      setProfile(doc);
      if (doc.locale) useLocale.getState().setLocale(doc.locale);
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, "users", user.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as UserDoc;
        setProfile(data);
        if (data.locale) useLocale.getState().setLocale(data.locale);
        setLoading(false);
      } else {
        setProfile(null);
      }
    });
    return unsub;
  }, [user]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      profile,
      loading,
      login: async (email, password) => {
        await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      },
      signup: async (email, password, displayName, homeCountry) => {
        signupInFlight.current = true;
        try {
          const cred = await createUserWithEmailAndPassword(
            auth,
            email.trim().toLowerCase(),
            password,
          );
          await updateProfile(cred.user, { displayName: displayName.trim() });
          await setupUserDoc(cred.user.uid, displayName.trim(), {
            locale: useLocale.getState().locale,
            homeCountry,
          });
        } finally {
          signupInFlight.current = false;
        }
      },
      logout: async () => {
        await signOut(auth);
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      },
      deleteAccount: async () => {
        const current = auth.currentUser;
        if (!current) throw new Error("not signed in");
        // Delete owned data first — once the auth user is gone the
        // client can no longer satisfy Firestore's owner-only rules.
        await deleteAccountData(current.uid);
        await deleteUser(current);
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
