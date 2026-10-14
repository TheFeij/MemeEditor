import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

interface ConfirmContextValue {
  confirm: ConfirmFn;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const settle = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <div className={`confirm-overlay${pending ? "" : " hidden"}`} id="confirm-overlay">
        <div className="confirm-card">
          <h3 id="confirm-title">{pending?.title ?? "Restart project?"}</h3>
          <p className="muted" id="confirm-message">
            {pending?.message ?? "All changes will be lost. This cannot be undone."}
          </p>
          <div className="row gap">
            <button id="confirm-cancel" className="btn" type="button" onClick={() => settle(false)}>
              Cancel
            </button>
            <button id="confirm-yes" className="btn btn-danger" type="button" onClick={() => settle(true)}>
              {pending?.confirmLabel ?? "Restart"}
            </button>
          </div>
        </div>
      </div>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
