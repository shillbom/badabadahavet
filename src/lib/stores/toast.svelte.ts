export type ToastKind = "success" | "error" | "info";
export type Toast = { id: number; kind: ToastKind; message: string };

let nextId = 1;

class ToastStore {
  toasts = $state<Toast[]>([]);

  push(kind: ToastKind, message: string) {
    const id = nextId++;
    this.toasts.push({ id, kind, message });
    setTimeout(() => this.dismiss(id), 3500);
  }

  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const toastStore = new ToastStore();

export const toast = {
  success: (m: string) => toastStore.push("success", m),
  error: (m: string) => toastStore.push("error", m),
  info: (m: string) => toastStore.push("info", m),
};
