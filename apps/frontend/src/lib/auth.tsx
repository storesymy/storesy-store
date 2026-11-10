import type { LoginInput, SignupInput, User } from "@storesy/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, api } from "./api";

interface AuthContextValue {
  user: User | null;
  /** True until the initial session probe finishes. */
  loading: boolean;
  signup: (input: SignupInput) => Promise<User>;
  login: (input: LoginInput) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(({ user: me }) => {
        if (!cancelled) setUser(me);
      })
      .catch((error: unknown) => {
        //401 = simply not signed in; anything else also means "no usable session".
        if (error instanceof ApiError && error.status !== 401) {
          console.error("session_probe_failed", error);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signup = useCallback(async (input: SignupInput): Promise<User> => {
    const created = await api.signup(input);
    setUser(created);
    return created;
  }, []);

  const login = useCallback(async (input: LoginInput): Promise<User> => {
    const signedIn = await api.login(input);
    setUser(signedIn);
    return signedIn;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signup, login, logout }),
    [user, loading, signup, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
