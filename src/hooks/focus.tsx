import { useState, useEffect } from "react";

const getFocusState = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return true;
  }
  return document.hasFocus() && document.visibilityState === "visible";
};

export const useDeviceFocus = () => {
  const [isFocused, setIsFocused] = useState(getFocusState);

  useEffect(() => {
    const handleFocusChange = () => {
      setIsFocused(getFocusState());
    };

    // Handle screen lock / focus changes
    document.addEventListener("visibilitychange", handleFocusChange);

    return () => {
      document.removeEventListener("visibilitychange", handleFocusChange);
    };
  }, []);

  return isFocused;
};
