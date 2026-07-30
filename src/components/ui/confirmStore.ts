import { create } from "zustand";

/**
 * Promise-based replacement for `window.confirm` / `window.prompt`. Native
 * dialogs are off-limits in this app: they look foreign, and installed
 * PWAs / in-app browsers on iOS sometimes suppress them entirely (which is
 * why "remove swim" could silently do nothing). Call `confirm()` or
 * `promptText()` from anywhere and `await` the answer; `<ConfirmDialog />`
 * (mounted once in App) renders it.
 */
export type ConfirmRequest = {
  id: number;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Set for prompt-style dialogs: the initial value of the text input. */
  defaultValue?: string;
  placeholder?: string;
  /** Prompt dialogs resolve with the text (or null); confirms with a boolean. */
  kind: "confirm" | "prompt";
};

type Answer = boolean | string | null;

type ConfirmState = {
  request: ConfirmRequest | null;
  settle: (answer: Answer) => void;
};

let nextId = 1;
let pending: ((answer: Answer) => void) | null = null;

export const useConfirmStore = create<ConfirmState>((set) => ({
  request: null,
  settle: (answer) => {
    pending?.(answer);
    pending = null;
    set({ request: null });
  },
}));

function open(request: Omit<ConfirmRequest, "id">): Promise<Answer> {
  // Only one dialog at a time — a second request cancels the first rather
  // than leaving its promise hanging forever.
  pending?.(request.kind === "prompt" ? null : false);
  return new Promise<Answer>((resolve) => {
    pending = resolve;
    useConfirmStore.setState({ request: { ...request, id: nextId++ } });
  });
}

export async function confirm(
  opts: Omit<ConfirmRequest, "id" | "kind" | "defaultValue" | "placeholder">,
): Promise<boolean> {
  return (await open({ ...opts, kind: "confirm" })) === true;
}

export async function promptText(
  opts: Omit<ConfirmRequest, "id" | "kind" | "danger">,
): Promise<string | null> {
  const answer = await open({ ...opts, kind: "prompt" });
  return typeof answer === "string" ? answer : null;
}
