import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";

export function usePosition() {
  const { profile } = useAuth();

  const currentLocation = useStore((s) => s.currentLocation);
  return currentLocation ?? profile?.lastLocation ?? null;
}
