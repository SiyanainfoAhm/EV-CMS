import type { ConfirmOptions } from "../context/ConfirmContext";

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

let confirmImpl: ConfirmFn | null = null;

/** Registered by ConfirmProvider — do not call directly. */
export function registerConfirm(fn: ConfirmFn): () => void {
  confirmImpl = fn;
  return () => {
    if (confirmImpl === fn) confirmImpl = null;
  };
}

/**
 * In-app confirmation dialog (same UX as web admin modals).
 */
export async function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void | Promise<void>,
  options?: Omit<ConfirmOptions, "title" | "message" | "confirmLabel">
): Promise<void> {
  if (!confirmImpl) {
    console.warn("[confirmAction] ConfirmProvider not mounted");
    return;
  }

  const ok = await confirmImpl({
    title,
    message,
    confirmLabel,
    destructive: options?.destructive ?? confirmLabel.toLowerCase().includes("sign out"),
    ...options,
  });

  if (!ok) return;

  try {
    await onConfirm();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Action failed";
    await confirmImpl({
      title: "Error",
      message: msg,
      confirmLabel: "OK",
      cancelLabel: "Close",
      destructive: false,
      icon: "✕",
    });
  }
}
