/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, Suspense, lazy } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Header, Footer } from "./components/Layout";
import { LandingPage } from "./components/LandingPage";
const DoctorSearch = lazy(() =>
  import("./components/DoctorSearch").then((m) => ({
    default: m.DoctorSearch,
  })),
);
const DoctorProfile = lazy(() =>
  import("./components/DoctorProfile").then((m) => ({
    default: m.DoctorProfile,
  })),
);
const BookingFlow = lazy(() =>
  import("./components/BookingFlow").then((m) => ({ default: m.BookingFlow })),
);
const Dashboard = lazy(() =>
  import("./components/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const DashboardDoctor = lazy(() =>
  import("./components/DashboardDoctor").then((m) => ({
    default: m.DashboardDoctor,
  })),
);
const DashboardAdmin = lazy(() =>
  import("./components/DashboardAdmin").then((m) => ({
    default: m.DashboardAdmin,
  })),
);
const ClinicWorkspace = lazy(
  () => import("./components/clinic/ClinicWorkspace"),
);
import { BookingResult } from "./components/BookingResult";
import { ScheduleManager } from "./components/ScheduleManager";
import { AiConsentPanel } from "./components/AiConsentPanel";
import { DepartmentsList } from "./components/DepartmentsList";
import { AuthModal } from "./components/AuthModal";
import { ResetPasswordView } from "./components/ResetPasswordView";
import { Doctor } from "./types";
import {
  getView,
  getResetPasswordToken,
  replaceSearchParams,
} from "./utils/urlSearchParams";
import {
  api,
  getStoredUser,
  getStoredToken,
  setStoredAuth,
  clearStoredAuth,
  AUTH_CLEARED_EVENT,
} from "./api/client";
import type { ApiAuthUser } from "./api/client";
import { mapDoctor } from "./api/mappers";
import { useToast } from "./contexts/ToastContext";
import { ModalOverlay, ModalCloseButton } from "./components/ModalOverlay";
import {
  sanitizeViewForUser,
  isDashboardView,
  defaultDashboardViewForUser,
  isPatientUser,
  normalizedUserRole,
} from "./utils/dashboardRbac";

const VALID_VIEWS = [
  "home",
  "search",
  "departments",
  "profile",
  "booking",
  "booking-success",
  "dashboard",
  "dashboard-doctor",
  "dashboard-admin",
  "dashboard-clinic",
  "reset-password",
];

/** Các view yêu cầu đăng nhập — guest truy cập sẽ về home. */
const PROTECTED_VIEWS = new Set([
  "dashboard",
  "dashboard-doctor",
  "dashboard-admin",
  "dashboard-clinic",
  "profile",
  "booking",
  "booking-success",
]);

const App: React.FC = () => {
  const toast = useToast();
  const [view, setView] = useState<string>(() => {
    const v = getView();
    if (v === "reset-password") {
      return getResetPasswordToken() ? "reset-password" : "home";
    }
    const base = v && VALID_VIEWS.includes(v) ? v : "home";
    return sanitizeViewForUser(base, getStoredUser());
  });
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [user, setUser] = useState<ApiAuthUser | null>(() => getStoredUser());
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<
    "login" | "register" | "forgot"
  >("login");
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  /** Guest bấm «Đặt lịch» — sau khi đăng nhập (BN) sẽ vào luồng booking. */
  const [pendingBookAfterLogin, setPendingBookAfterLogin] = useState(false);
  /** Guest bấm xem bác sĩ — sau khi đăng nhập BN sẽ vào profile (selectedDoctor đã set). */
  const [pendingViewProfileAfterLogin, setPendingViewProfileAfterLogin] =
    useState(false);

  const applyViewToHistory = (newView: string) => {
    if (newView === "home") {
      window.history.replaceState(null, "", window.location.pathname || "/");
    } else if (newView === "search") {
      replaceSearchParams({
        view: "search",
        page: 1,
        departmentId: null,
        token: null,
        q: null,
      });
    } else if (newView === "departments") {
      replaceSearchParams({ view: "departments", token: null });
    } else if (newView === "reset-password") {
      const t = getResetPasswordToken();
      replaceSearchParams({
        view: "reset-password",
        ...(t ? { token: t } : { token: null }),
      });
    } else {
      replaceSearchParams({ view: newView, token: null });
    }
  };

  useEffect(() => {
    const v = getView();
    if (v === "reset-password") {
      setView(getResetPasswordToken() ? "reset-password" : "home");
      return;
    }
    if (v && VALID_VIEWS.includes(v)) {
      const next = sanitizeViewForUser(v, getStoredUser());
      setView(next);
      if (next !== v) {
        applyViewToHistory(next);
      }
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const v = getView();
      if (v === "reset-password") {
        setView(getResetPasswordToken() ? "reset-password" : "home");
        return;
      }
      if (v && VALID_VIEWS.includes(v)) {
        const next = sanitizeViewForUser(v, getStoredUser());
        setView(next);
        if (next !== v) {
          applyViewToHistory(next);
        }
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }, [view]);

  const handleNavigate = (newView: string) => {
    const target = sanitizeViewForUser(newView, user);
    if (user && target !== newView) {
      const role = normalizedUserRole(user.role);
      if (role === "doctor") {
        toast.info("Tài khoản bác sĩ chỉ dùng dashboard bác sĩ.");
      } else if (role === "admin") {
        toast.info("Tài khoản quản trị chỉ dùng dashboard quản trị.");
      }
    }
    setView(target);
    applyViewToHistory(target);
  };

  const handleNavigateToSearchWithDept = (departmentId: string) => {
    if (user && !isPatientUser(user)) {
      handleNavigate(defaultDashboardViewForUser(user));
      return;
    }
    replaceSearchParams({
      view: "search",
      page: 1,
      departmentId,
      token: null,
      q: null,
    });
    setView("search");
  };

  const handleNavigateToSearch = useCallback(
    (query?: string) => {
      if (user && !isPatientUser(user)) {
        handleNavigate(defaultDashboardViewForUser(user));
        return;
      }
      const t = query?.trim();
      replaceSearchParams({
        view: "search",
        page: 1,
        departmentId: null,
        token: null,
        q: t ? t : null,
      });
      setView("search");
    },
    [user],
  );

  const handleBook = (doctor: Doctor) => {
    if (user && !isPatientUser(user)) {
      toast.info("Tài khoản bác sĩ không thể đặt lịch khám tại đây.");
      handleNavigate(defaultDashboardViewForUser(user));
      return;
    }
    setSelectedDoctor(doctor);
    if (!user) {
      setPendingBookAfterLogin(true);
      toast.info("Vui lòng đăng nhập để đặt lịch khám.");
      setAuthModalTab("login");
      setAuthModalOpen(true);
      return;
    }
    setView("booking");
    applyViewToHistory("booking");
  };

  const handleViewProfile = (doctor: Doctor) => {
    if (user && !isPatientUser(user)) {
      toast.info("Tài khoản bác sĩ không dùng luồng đặt lịch bệnh nhân.");
      handleNavigate(defaultDashboardViewForUser(user));
      return;
    }
    setSelectedDoctor(doctor);
    if (!user) {
      setPendingViewProfileAfterLogin(true);
      toast.info("Vui lòng đăng nhập để xem thông tin bác sĩ.");
      setAuthModalTab("login");
      setAuthModalOpen(true);
      return;
    }
    setView("profile");
    applyViewToHistory("profile");
  };

  const handleAuthSuccess = (token: string, u: ApiAuthUser) => {
    setStoredAuth(token, u);
    setUser(u);
    if (pendingBookAfterLogin) {
      setPendingBookAfterLogin(false);
      if (isPatientUser(u)) {
        setView("booking");
        applyViewToHistory("booking");
        return;
      }
    }
    if (pendingViewProfileAfterLogin) {
      setPendingViewProfileAfterLogin(false);
      if (isPatientUser(u)) {
        setView("profile");
        applyViewToHistory("profile");
        return;
      }
    }
    handleNavigate(defaultDashboardViewForUser(u));
  };

  const handleProfileUpdated = useCallback((u: ApiAuthUser) => {
    const t = getStoredToken();
    if (t) setStoredAuth(t, u);
    setUser(u);
  }, []);

  const executeLogout = async () => {
    setLogoutConfirmOpen(false);
    try {
      await api.logout();
    } catch {
      // ignore
    }
    clearStoredAuth();
    setUser(null);
    setSelectedDoctor(null);
    setPendingBookAfterLogin(false);
    setPendingViewProfileAfterLogin(false);
    setAuthModalOpen(false);
    setView("home");
    applyViewToHistory("home");
    toast.success("Đã đăng xuất.");
  };

  /**
   * Bảo vệ route: guest + URL yêu cầu đăng nhập → về home;
   * user sai dashboard (bookmark / stale state) → về đúng dashboard role.
   */
  useEffect(() => {
    if (!user && PROTECTED_VIEWS.has(view)) {
      if (view === "booking" || view === "booking-success") {
        toast.info(
          "Vui lòng đăng nhập tài khoản bệnh nhân để đặt lịch / xem kết quả thanh toán.",
        );
        setAuthModalTab("login");
        setAuthModalOpen(true);
      } else if (view === "profile") {
        toast.info("Vui lòng đăng nhập để xem thông tin bác sĩ.");
        setAuthModalTab("login");
        setAuthModalOpen(true);
      }
      setView("home");
      applyViewToHistory("home");
      return;
    }
    if (user) {
      const next = sanitizeViewForUser(view, user);
      if (next !== view) {
        const role = normalizedUserRole(user.role);
        if (role === "doctor") {
          toast.info("Tài khoản bác sĩ chỉ truy cập dashboard bác sĩ.");
        } else if (role === "admin") {
          toast.info("Tài khoản quản trị chỉ dùng dashboard quản trị.");
        }
        setView(next);
        applyViewToHistory(next);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, view]);

  /**
   * Lắng nghe event khi API gặp 401 (token hết hạn) → reset user state.
   * useEffect bảo vệ ở trên sẽ tự đẩy về home nếu đang xem dashboard.
   */
  useEffect(() => {
    const onAuthCleared = (event: Event) => {
      setUser(null);
      setSelectedDoctor(null);
      if ((event as CustomEvent).detail?.reason !== "password_changed")
        toast.error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    };
    window.addEventListener(AUTH_CLEARED_EVENT, onAuthCleared);
    return () => window.removeEventListener(AUTH_CLEARED_EVENT, onAuthCleared);
  }, [toast]);

  const renderView = () => {
    switch (view) {
      case "home":
        return (
          <LandingPage
            onNavigate={handleNavigate}
            onNavigateToSearchWithDept={handleNavigateToSearchWithDept}
            onNavigateToSearch={handleNavigateToSearch}
            onBook={handleBook}
            onViewProfile={handleViewProfile}
          />
        );
      case "search":
        return (
          <DoctorSearch onBook={handleBook} onViewProfile={handleViewProfile} />
        );
      case "departments":
        return (
          <DepartmentsList
            onNavigate={handleNavigate}
            onNavigateToSearchWithDept={handleNavigateToSearchWithDept}
          />
        );
      case "profile":
        return selectedDoctor ? (
          <DoctorProfile doctor={selectedDoctor} onBook={handleBook} />
        ) : (
          <LandingPage
            onNavigate={handleNavigate}
            onNavigateToSearchWithDept={handleNavigateToSearchWithDept}
            onNavigateToSearch={handleNavigateToSearch}
            onBook={handleBook}
            onViewProfile={handleViewProfile}
          />
        );
      case "booking":
        return selectedDoctor ? (
          <BookingFlow
            doctor={selectedDoctor}
            onComplete={() => handleNavigate("dashboard")}
            onPaymentSuccess={() => {
              handleNavigate("booking-success");
            }}
            onCancel={() => setView("search")}
          />
        ) : (
          <LandingPage
            onNavigate={handleNavigate}
            onNavigateToSearchWithDept={handleNavigateToSearchWithDept}
            onNavigateToSearch={handleNavigateToSearch}
            onBook={handleBook}
            onViewProfile={handleViewProfile}
          />
        );
      case "booking-success":
        return (
          <BookingResult onDashboard={() => handleNavigate("dashboard")} />
        );
      case "dashboard-clinic":
        return user ? (
          <ClinicWorkspace
            user={user}
            onBookWaitlist={async (doctorId) => {
              try {
                const doctor = await api.getDoctor(doctorId);
                handleBook(mapDoctor(doctor));
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "Không mở được lịch bác sĩ",
                );
              }
            }}
          />
        ) : null;
      case "dashboard":
        return (
          <Dashboard
            key={user?.id ?? "guest"}
            user={user}
            onProfileUpdated={handleProfileUpdated}
            onNavigate={handleNavigate}
          />
        );
      case "dashboard-doctor":
        return <DashboardDoctor key={user?.id ?? "guest"} />;
      case "dashboard-admin":
        return (
          <>
            <ScheduleManager />
            <DashboardAdmin key={user?.id ?? "guest"} />
          </>
        );
      case "reset-password":
        return (
          <ResetPasswordView
            token={getResetPasswordToken()}
            onNavigate={handleNavigate}
          />
        );
      default:
        return (
          <LandingPage
            onNavigate={handleNavigate}
            onNavigateToSearchWithDept={handleNavigateToSearchWithDept}
            onNavigateToSearch={handleNavigateToSearch}
            onBook={handleBook}
            onViewProfile={handleViewProfile}
          />
        );
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        onNavigate={handleNavigate}
        onNavigateToSearch={handleNavigateToSearch}
        user={user}
        onOpenAuth={(tab) => {
          setAuthModalTab(tab);
          setAuthModalOpen(true);
        }}
        onLogout={() => setLogoutConfirmOpen(true)}
      />
      {user && (
        <nav
          className="max-w-7xl mx-auto w-full flex flex-wrap gap-3 px-4 py-3"
          aria-label="Nghiệp vụ phòng khám"
        >
          <button
            className="rounded-lg border px-3 py-2"
            onClick={() => handleNavigate(defaultDashboardViewForUser(user))}
          >
            Khu vực của tôi
          </button>
          <button
            className="rounded-lg border px-3 py-2"
            onClick={() => handleNavigate("dashboard-clinic")}
          >
            Phòng khám · Tiếp đón · Hồ sơ · Thu ngân
          </button>
          <details className="w-full">
            <summary className="cursor-pointer">
              Quyền sử dụng AI và dữ liệu
            </summary>
            <AiConsentPanel admin={user.role === "admin"} />
          </details>
        </nav>
      )}
      <main className="flex-grow pb-20 md:pb-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="w-full"
          >
            <Suspense
              fallback={
                <p className="p-8 text-center" role="status">
                  Đang tải…
                </p>
              }
            >
              {renderView()}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>
      <Footer />
      <AuthModal
        open={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
          setPendingBookAfterLogin(false);
          setPendingViewProfileAfterLogin(false);
        }}
        onSuccess={handleAuthSuccess}
        initialTab={authModalTab}
      />

      <ModalOverlay
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
      >
        <div className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
          <ModalCloseButton onClose={() => setLogoutConfirmOpen(false)} />
          <h2 className="pr-10 text-lg font-bold text-slate-900">Đăng xuất?</h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Bạn sẽ thoát phiên và cần đăng nhập lại để dùng tài khoản.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(false)}
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:w-auto"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void executeLogout()}
              className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 sm:w-auto"
            >
              Đăng xuất
            </button>
          </div>
        </div>
      </ModalOverlay>
    </div>
  );
};

export default App;
