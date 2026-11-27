import { canAccessMenu } from "@storesy/shared";
import type { MenuKey } from "@storesy/shared";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

/** Route-level mirror of the API menu guard; direct URLs cannot bypass it. */
export function RequireMenu({ menu, children }: { menu: MenuKey; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessMenu(user.role, user.menuAccess, menu)) {
    return <Navigate to="/home" replace />;
  }
  return <>{children}</>;
}
