import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, api } from "./api";
import { useAuth } from "./auth";

/**
 * One small fetch shared by every Shell: the sidebar's paid-but-unfulfilled
 * order count. It refreshes on navigation, when the tab becomes visible, and
 * on a slow poll, so the badge stays useful without a websocket.
 */

interface OrdersBadgeValue {
  count: number;
  refresh: () => void;
}

const OrdersBadgeContext = createContext<OrdersBadgeValue | null>(null);

export function OrdersBadgeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!user) {
      setCount(0);
      return;
    }
    api
      .orderSummary()
      .then(({ toProcess }) => setCount(toProcess))
      .catch((error: unknown) => {
        // 401 mid-tab: the page itself will bounce to login. Keep the last
        // count for transient errors rather than flashing zero.
        if (error instanceof ApiError && error.status === 401) setCount(0);
      });
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh, location.pathname]);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(refresh, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, user]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);
  return <OrdersBadgeContext.Provider value={value}>{children}</OrdersBadgeContext.Provider>;
}

export function useOrdersToProcess(): OrdersBadgeValue {
  const context = useContext(OrdersBadgeContext);
  if (!context) {
    throw new Error("useOrdersToProcess must be used inside <OrdersBadgeProvider>");
  }
  return context;
}
