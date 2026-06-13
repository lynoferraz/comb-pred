"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle, XCircle, Info, X } from "lucide-react";

export type ToastVariant = "success" | "error" | "info" | "pending";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  title: string;
  detail?: string;
  leaving?: boolean;
}

interface ToastApi {
  toast: (variant: ToastVariant, title: string, detail?: string) => number;
  /** Update an existing toast in place (e.g. pending → success). */
  updateToast: (
    id: number,
    variant: ToastVariant,
    title: string,
    detail?: string,
  ) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}

const AUTO_DISMISS_MS: Record<ToastVariant, number> = {
  success: 4000,
  info: 5000,
  error: 8000,
  pending: 0, // stays until updated or dismissed
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // The portal can only render after mount: portaling into document.body
  // during hydration makes the client tree diverge from the server HTML
  // (React hydration error #418).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const remove = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    // Two-phase removal so the exit animation can play.
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, leaving: true } : i)),
    );
    setTimeout(
      () => setItems((prev) => prev.filter((i) => i.id !== id)),
      180,
    );
  }, []);

  const schedule = useCallback(
    (id: number, variant: ToastVariant) => {
      const old = timers.current.get(id);
      if (old) clearTimeout(old);
      const ms = AUTO_DISMISS_MS[variant];
      if (ms > 0) timers.current.set(id, setTimeout(() => remove(id), ms));
    },
    [remove],
  );

  const toast = useCallback(
    (variant: ToastVariant, title: string, detail?: string) => {
      const id = nextId++;
      setItems((prev) => [...prev.slice(-4), { id, variant, title, detail }]);
      schedule(id, variant);
      return id;
    },
    [schedule],
  );

  const updateToast = useCallback(
    (id: number, variant: ToastVariant, title: string, detail?: string) => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, variant, title, detail, leaving: false } : i,
        ),
      );
      schedule(id, variant);
    },
    [schedule],
  );

  return (
    <ToastContext.Provider value={{ toast, updateToast, dismissToast: remove }}>
      {children}
      {mounted &&
        createPortal(
          <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 w-[min(360px,calc(100vw-40px))]">
            {items.map((item) => (
              <ToastCard key={item.id} item={item} onClose={() => remove(item.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const icon =
    item.variant === "success" ? (
      <CheckCircle size={16} className="text-accent shrink-0 mt-0.5" />
    ) : item.variant === "error" ? (
      <XCircle size={16} className="text-no shrink-0 mt-0.5" />
    ) : item.variant === "pending" ? (
      <span className="cim-spinner shrink-0 mt-1" style={{ width: 12, height: 12 }} />
    ) : (
      <Info size={16} className="text-ink2 shrink-0 mt-0.5" />
    );

  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 bg-surface border rounded-2xl px-4 py-3 shadow-lg ${
        item.leaving ? "cim-toast-out" : "cim-toast-in"
      } ${item.variant === "error" ? "border-no/40" : "border-line"}`}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ink">{item.title}</div>
        {item.detail && (
          <div className="mt-0.5 text-xs text-ink2 break-words">{item.detail}</div>
        )}
      </div>
      <button
        onClick={onClose}
        className="text-ink3 hover:text-ink transition-colors shrink-0"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
