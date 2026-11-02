import type { ApiAuthUser, UserRole } from "../api/client";

/** Chuẩn hoá vai trò: thiếu role coi là bệnh nhân. */
export function normalizedUserRole(role?: UserRole): UserRole {
  return role ?? "user";
}

const DASHBOARD_BY_ROLE: Record<UserRole, string> = {
  user: "dashboard",
  doctor: "dashboard-doctor",
  admin: "dashboard-admin",
  receptionist: "dashboard-clinic",
  cashier: "dashboard-clinic",
};

/** View dashboard tương ứng với role (mỗi role chỉ một khu vực). */
export function defaultDashboardViewForUser(user: ApiAuthUser | null): string {
  if (!user) return "home";
  return DASHBOARD_BY_ROLE[normalizedUserRole(user.role)];
}

/** View có phải là một trong ba dashboard không. */
export function isDashboardView(view: string): boolean {
  return (
    view === "dashboard" ||
    view === "dashboard-doctor" ||
    view === "dashboard-admin" ||
    view === "dashboard-clinic"
  );
}

/** Role được phép mở view dashboard này (không dùng thứ bậc leo — tách biệt tuyến đường). */
export function requiredRoleForDashboardView(view: string): UserRole | null {
  if (view === "dashboard") return "user";
  if (view === "dashboard-doctor") return "doctor";
  if (view === "dashboard-admin") return "admin";
  return null;
}

export function userMayAccessDashboardView(
  user: ApiAuthUser | null,
  view: string,
): boolean {
  if (view === "dashboard-clinic") return Boolean(user);
  const need = requiredRoleForDashboardView(view);
  if (need === null) return true;
  if (!user) return false;
  return normalizedUserRole(user.role) === need;
}

export function isPatientUser(user: ApiAuthUser | null): boolean {
  if (!user) return false;
  return normalizedUserRole(user.role) === "user";
}

export function isDoctorUser(user: ApiAuthUser | null): boolean {
  return !!user && normalizedUserRole(user.role) === "doctor";
}

export function isAdminUser(user: ApiAuthUser | null): boolean {
  return !!user && normalizedUserRole(user.role) === "admin";
}

/**
 * Chuẩn hoá view theo role: bác sĩ chỉ dashboard-doctor, admin chỉ dashboard-admin,
 * bệnh nhân không vào dashboard role khác. Guest không mở dashboard.
 */
export function sanitizeViewForUser(
  view: string,
  user: ApiAuthUser | null,
): string {
  if (view === "reset-password") return view;

  if (!user) {
    if (isDashboardView(view)) return "home";
    return view;
  }

  const role = normalizedUserRole(user.role);

  if (view === "dashboard-clinic") return view;
  if (role === "receptionist" || role === "cashier") return "dashboard-clinic";

  if (role === "doctor") {
    return view === "dashboard-doctor" ? view : "dashboard-doctor";
  }

  if (role === "admin") {
    return view === "dashboard-admin" ? view : "dashboard-admin";
  }

  if (view === "dashboard-doctor" || view === "dashboard-admin") {
    return "dashboard";
  }

  return view;
}

/** @deprecated Dùng {@link sanitizeViewForUser} */
export function sanitizeDashboardViewForUser(
  view: string,
  user: ApiAuthUser | null,
): string {
  return sanitizeViewForUser(view, user);
}
