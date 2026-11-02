import React, { useState, useEffect, useMemo } from "react";
import {
  Calendar,
  CalendarClock,
  CreditCard,
  Loader2,
  User,
  CheckCircle2,
  Clock3,
  Stethoscope,
  ClipboardList,
  Pencil,
  Save,
  X,
  Wallet,
  Receipt,
  Mail,
  Phone,
  XCircle,
  Filter,
  FileText,
  Activity,
  Pill,
  StickyNote,
  AlertCircle,
  Trash2,
  AlertTriangle,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  api,
  resolveApiAssetUrl,
  ApiRequestError,
  clearStoredAuth,
  AUTH_CLEARED_EVENT,
} from "../api/client";
import type {
  ApiAppointment,
  ApiAuthUser,
  ApiPatientMedicalRecord,
  ApiPaymentHistoryItem,
} from "../api/client";
import { AvatarPicker } from "./AvatarPicker";
import { ModalOverlay, ModalCloseButton } from "./ModalOverlay";
import { useToast } from "../contexts/ToastContext";
import { formatDoctorName } from "../utils/formatDoctorName";
import {
  validateStrongPassword,
  validateUpdateProfileForm,
} from "../utils/patient-register.validation";
import { AdSlotSection } from "./AdSlotSection";
import { PatientAppointmentTools } from "./PatientAppointmentTools";

function formatAppointmentDateTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const slotDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const timeStr = d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (slotDate.getTime() === today.getTime()) return `Hôm nay, ${timeStr}`;
  if (slotDate.getTime() === tomorrow.getTime()) return `Ngày mai, ${timeStr}`;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}, ${timeStr}`;
}

function formatHistoryDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatFullDateTimeVi(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const time = d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day}/${month}/${year} · ${time}`;
}

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + " ₫";
}

function appointmentStatusPresentation(status: string): {
  label: string;
  className: string;
} {
  const s = status.toLowerCase();
  if (s === "completed")
    return { label: "Hoàn tất", className: "bg-emerald-50 text-emerald-800" };
  if (s === "confirmed")
    return { label: "Đã xác nhận", className: "bg-sky-50 text-sky-800" };
  if (s === "pending")
    return {
      label: "Chờ thanh toán cọc",
      className: "bg-amber-50 text-amber-900",
    };
  if (s === "cancelled")
    return { label: "Đã hủy", className: "bg-red-50 text-red-800" };
  return { label: status, className: "bg-slate-100 text-slate-700" };
}

function paymentStatusPresentation(status: string): {
  label: string;
  badgeClass: string;
  dotClass: string;
} {
  const s = status.toLowerCase();
  if (s === "paid")
    return {
      label: "Thành công",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dotClass: "bg-emerald-500",
    };
  if (s === "pending")
    return {
      label: "Đang chờ",
      badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
      dotClass: "bg-amber-500",
    };
  if (s === "failed")
    return {
      label: "Thất bại",
      badgeClass: "bg-red-50 text-red-700 border-red-200",
      dotClass: "bg-red-500",
    };
  return {
    label: status,
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    dotClass: "bg-slate-400",
  };
}

function paymentTypeLabel(type: string | null): string {
  const t = (type ?? "").toLowerCase();
  if (t === "deposit") return "Đặt cọc khám";
  if (t === "full") return "Thanh toán đủ";
  return "Giao dịch";
}

type DashboardTab = "upcoming" | "history" | "payments";
type PaymentFilter = "all" | "paid" | "pending" | "failed";

interface DashboardProps {
  user: ApiAuthUser | null;
  onProfileUpdated: (u: ApiAuthUser) => void;
  /** Đặt lịch / tìm bác sĩ */
  onNavigate?: (view: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  user,
  onProfileUpdated,
  onNavigate,
}) => {
  const toast = useToast();
  const [appointments, setAppointments] = useState<ApiAppointment[]>([]);
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [payments, setPayments] = useState<ApiPaymentHistoryItem[]>([]);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [loadingPayments, setLoadingPayments] = useState(true);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);

  const [editingProfile, setEditingProfile] = useState(false);
  const [editForm, setEditForm] = useState<{ fullName: string; phone: string }>(
    {
      fullName: "",
      phone: "",
    },
  );
  const [editFieldErrors, setEditFieldErrors] = useState<
    Record<string, string>
  >({});
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [pwdForm, setPwdForm] = useState<{
    currentPassword: string;
    password: string;
    confirmPassword: string;
  }>({
    currentPassword: "",
    password: "",
    confirmPassword: "",
  });
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);

  const [activeTab, setActiveTab] = useState<DashboardTab>("upcoming");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");

  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordData, setRecordData] = useState<ApiPatientMedicalRecord | null>(
    null,
  );
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<ApiAppointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const showPatientProfile = Boolean(
    user && (user.role === "user" || user.role == null),
  );

  useEffect(() => {
    api
      .getMyAppointments()
      .then(setAppointments)
      .catch(() => setAppointments([]))
      .finally(() => setLoadingAppointments(false));
  }, []);

  useEffect(() => {
    setLoadingPayments(true);
    api
      .getMyPayments(paymentsPage)
      .then(setPayments)
      .catch(() => setPayments([]))
      .finally(() => setLoadingPayments(false));
  }, [paymentsPage]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    api
      .getMe()
      .then(({ user: u }) => {
        if (!cancelled) onProfileUpdated(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id, onProfileUpdated]);

  const handlePatientAvatarChange = async (file: File | null) => {
    setAvatarError(null);
    if (!file) {
      setPendingAvatarFile(null);
      return;
    }
    setPendingAvatarFile(file);
    setAvatarBusy(true);
    try {
      const { user: u } = await api.updateMyAvatar(file);
      onProfileUpdated(u);
      setPendingAvatarFile(null);
      toast.success("Đã cập nhật ảnh đại diện.");
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : "Không tải được ảnh");
    } finally {
      setAvatarBusy(false);
    }
  };

  const startEditProfile = () => {
    if (!user) return;
    setEditForm({
      fullName: user.fullName ?? "",
      phone: user.phone ?? "",
    });
    setPwdForm({ currentPassword: "", password: "", confirmPassword: "" });
    setShowCurrentPwd(false);
    setShowNewPwd(false);
    setShowConfirmPwd(false);
    setEditFieldErrors({});
    setEditError(null);
    setEditingProfile(true);
  };

  const cancelEditProfile = () => {
    setEditingProfile(false);
    setEditFieldErrors({});
    setEditError(null);
    setShowCurrentPwd(false);
    setShowNewPwd(false);
    setShowConfirmPwd(false);
  };

  const submitEditProfile = async () => {
    if (!user) return;
    const clientErr = validateUpdateProfileForm({
      fullName: editForm.fullName,
      phone: editForm.phone,
    });
    if (clientErr) {
      setEditFieldErrors(clientErr);
      setEditError(null);
      return;
    }
    const wantChangePwd = Boolean(
      pwdForm.currentPassword.trim() ||
      pwdForm.password.trim() ||
      pwdForm.confirmPassword.trim(),
    );

    if (wantChangePwd) {
      const fe: Record<string, string> = {};
      if (!pwdForm.currentPassword.trim())
        fe.currentPassword = "Vui lòng nhập mật khẩu hiện tại";
      if (!pwdForm.password.trim()) fe.password = "Vui lòng nhập mật khẩu mới";
      if (!pwdForm.confirmPassword.trim())
        fe.confirmPassword = "Vui lòng nhập lại mật khẩu mới";
      if (
        pwdForm.password &&
        pwdForm.confirmPassword &&
        pwdForm.password !== pwdForm.confirmPassword
      ) {
        fe.confirmPassword = "Mật khẩu nhập lại không khớp";
      }
      const pwdErr = pwdForm.password
        ? validateStrongPassword(pwdForm.password)
        : null;
      if (pwdErr) fe.password = pwdErr;
      if (Object.keys(fe).length > 0) {
        setEditFieldErrors((prev) => ({ ...prev, ...fe }));
        return;
      }
    }

    setEditBusy(true);
    setEditError(null);
    setEditFieldErrors({});
    try {
      const { user: u } = await api.updateMyProfile({
        fullName: editForm.fullName.trim(),
        phone: editForm.phone.trim(),
      });
      onProfileUpdated(u);
      if (wantChangePwd) {
        await api.changeMyPassword(pwdForm);
        clearStoredAuth();
        window.dispatchEvent(
          new CustomEvent(AUTH_CLEARED_EVENT, {
            detail: { reason: "password_changed" },
          }),
        );
        toast.success("Đã lưu hồ sơ và đổi mật khẩu. Vui lòng đăng nhập lại.");
        return;
      }
      setEditingProfile(false);
      toast.success(
        wantChangePwd
          ? "Đã cập nhật hồ sơ và đổi mật khẩu."
          : "Đã cập nhật hồ sơ.",
      );
    } catch (e) {
      if (e instanceof ApiRequestError && e.fieldErrors) {
        setEditFieldErrors(e.fieldErrors);
      } else {
        setEditError(
          e instanceof Error ? e.message : "Không cập nhật được hồ sơ",
        );
      }
    } finally {
      setEditBusy(false);
    }
  };

  const { upcoming, past } = useMemo(() => {
    const tNow = Date.now();
    const withSlot = appointments.filter((a) => a.slot?.slotTime);
    const up: ApiAppointment[] = [];
    const pa: ApiAppointment[] = [];
    for (const a of withSlot) {
      const t = new Date(a.slot!.slotTime).getTime();
      const status = a.status.toLowerCase();
      // Cancelled / completed luôn thuộc lịch sử (kể cả khi slot_time còn trong tương lai).
      if (status === "cancelled" || status === "completed") {
        pa.push(a);
        continue;
      }
      if (t >= tNow) up.push(a);
      else pa.push(a);
    }
    up.sort(
      (a, b) =>
        new Date(a.slot!.slotTime).getTime() -
        new Date(b.slot!.slotTime).getTime(),
    );
    pa.sort(
      (a, b) =>
        new Date(b.slot!.slotTime).getTime() -
        new Date(a.slot!.slotTime).getTime(),
    );
    return { upcoming: up, past: pa };
  }, [appointments]);

  const completedCount = useMemo(
    () =>
      appointments.filter((a) => a.status.toLowerCase() === "completed").length,
    [appointments],
  );

  const totalSpent = useMemo(
    () =>
      payments
        .filter((p) => p.status === "paid")
        .reduce((sum, p) => sum + (p.amount ?? 0), 0),
    [payments],
  );

  const paidPaymentCount = useMemo(
    () => payments.filter((p) => p.status === "paid").length,
    [payments],
  );

  const filteredPayments = useMemo(
    () =>
      paymentFilter === "all"
        ? payments
        : payments.filter((p) => p.status === paymentFilter),
    [payments, paymentFilter],
  );

  const openMedicalRecordModal = async (appointmentId: string) => {
    setRecordModalOpen(true);
    setRecordData(null);
    setRecordError(null);
    setRecordLoading(true);
    try {
      const r = await api.getPatientMedicalRecordByAppointment(appointmentId);
      setRecordData(r);
    } catch (e) {
      setRecordError(
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Không tải được kết quả khám",
      );
    } finally {
      setRecordLoading(false);
    }
  };

  const closeMedicalRecordModal = () => {
    setRecordModalOpen(false);
    setTimeout(() => {
      setRecordData(null);
      setRecordError(null);
    }, 200);
  };

  const openCancelModal = (apt: ApiAppointment) => {
    setCancelTarget(apt);
    setCancelReason("");
    setCancelError(null);
  };
  const closeCancelModal = () => {
    if (cancelBusy) return;
    setCancelTarget(null);
    setCancelReason("");
    setCancelError(null);
  };
  const submitCancel = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await api.cancelMyAppointment(
        cancelTarget.id,
        cancelReason.trim() || null,
      );
      const list = await api.getMyAppointments();
      setAppointments(list);
      toast.success("Đã huỷ cuộc hẹn.");
      setCancelTarget(null);
      setCancelReason("");
    } catch (e) {
      setCancelError(
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Không huỷ được cuộc hẹn",
      );
    } finally {
      setCancelBusy(false);
    }
  };

  const firstName = user?.fullName?.trim().split(/\s+/).pop() ?? "bạn";

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-slate-50 via-white to-sky-50/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10 space-y-6">
        <PatientAppointmentTools />
        <AdSlotSection placement="dashboard_user" aspect="6/1" />
        {/* HERO: Profile card */}
        {showPatientProfile && user && (
          <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-br from-primary/15 via-sky-100/60 to-violet-100/40 pointer-events-none" />
            <div className="relative p-6 sm:p-8">
              {(avatarError || editError) && (
                <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                  {avatarError || editError}
                </div>
              )}

              {!editingProfile ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-6">
                  <div className="flex flex-col items-center sm:items-start gap-2 shrink-0">
                    <AvatarPicker
                      file={pendingAvatarFile}
                      onChange={(f) => void handlePatientAvatarChange(f)}
                      existingImageUrl={resolveApiAssetUrl(user.avatarUrl)}
                      label="Ảnh đại diện"
                      size="lg"
                      disabled={avatarBusy}
                    />
                    {avatarBusy ? (
                      <p className="text-xs font-medium text-primary inline-flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Đang tải lên…
                      </p>
                    ) : null}
                  </div>

                  <div className="flex-1 min-w-0 text-center sm:text-left">
                    <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                      Xin chào, {firstName}
                    </p>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                      {user.fullName}
                    </h1>
                    <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap items-center sm:items-start gap-2 sm:gap-x-5 sm:gap-y-1.5 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[18rem]">
                          {user.email}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                        {user.phone ? (
                          <span>{user.phone}</span>
                        ) : (
                          <span className="italic text-slate-400">
                            Chưa cập nhật SĐT
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-row sm:flex-col gap-2 sm:items-end shrink-0">
                    <button
                      type="button"
                      onClick={startEditProfile}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-xl font-semibold text-sm text-slate-700 hover:bg-slate-50 hover:border-primary/40 hover:text-primary transition-colors shadow-sm"
                    >
                      <Pencil className="w-4 h-4" />
                      Chỉnh sửa
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate?.("search")}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl font-bold text-sm hover:bg-primary/90 transition-colors shadow-md shadow-primary/20"
                    >
                      <Calendar className="w-4 h-4" />
                      Đặt lịch
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-6">
                  <div className="flex flex-col items-center gap-2 shrink-0">
                    <AvatarPicker
                      file={pendingAvatarFile}
                      onChange={(f) => void handlePatientAvatarChange(f)}
                      existingImageUrl={resolveApiAssetUrl(user.avatarUrl)}
                      label="Ảnh đại diện"
                      size="lg"
                      disabled={avatarBusy || editBusy}
                    />
                    {avatarBusy ? (
                      <p className="text-xs font-medium text-primary inline-flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Đang tải lên…
                      </p>
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Họ tên *
                      </label>
                      <input
                        type="text"
                        value={editForm.fullName}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            fullName: e.target.value,
                          }))
                        }
                        className={`w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-primary outline-none ${
                          editFieldErrors.fullName
                            ? "border-red-300"
                            : "border-slate-200"
                        }`}
                        placeholder="Nguyễn Văn A"
                        disabled={editBusy}
                      />
                      {editFieldErrors.fullName && (
                        <p className="mt-1 text-xs text-red-600">
                          {editFieldErrors.fullName}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        value={user.email}
                        disabled
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed"
                      />
                      <p className="mt-1 text-xs text-slate-400">
                        Email là định danh đăng nhập, không thể thay đổi.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Số điện thoại *
                      </label>
                      <input
                        type="tel"
                        value={editForm.phone}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, phone: e.target.value }))
                        }
                        className={`w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-primary outline-none ${
                          editFieldErrors.phone
                            ? "border-red-300"
                            : "border-slate-200"
                        }`}
                        placeholder="0901234567"
                        disabled={editBusy}
                      />
                      {editFieldErrors.phone && (
                        <p className="mt-1 text-xs text-red-600">
                          {editFieldErrors.phone}
                        </p>
                      )}
                    </div>

                    <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50/40 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            Đổi mật khẩu (tuỳ chọn)
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Nếu không muốn đổi mật khẩu, hãy để trống các ô bên
                            dưới.
                          </p>
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3 mt-4">
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-medium text-slate-700 mb-1">
                            Mật khẩu hiện tại
                          </label>
                          <div className="relative">
                            <input
                              type={showCurrentPwd ? "text" : "password"}
                              value={pwdForm.currentPassword}
                              onChange={(e) =>
                                setPwdForm((f) => ({
                                  ...f,
                                  currentPassword: e.target.value,
                                }))
                              }
                              className={`w-full px-4 pr-12 py-2.5 border rounded-xl focus:ring-2 focus:ring-primary outline-none ${
                                editFieldErrors.currentPassword
                                  ? "border-red-300 bg-red-50/40"
                                  : "border-slate-200"
                              }`}
                              placeholder="••••••••"
                              disabled={editBusy}
                            />
                            <button
                              type="button"
                              onClick={() => setShowCurrentPwd((v) => !v)}
                              disabled={editBusy}
                              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                              aria-label={
                                showCurrentPwd ? "Ẩn mật khẩu" : "Hiện mật khẩu"
                              }
                            >
                              {showCurrentPwd ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                          {editFieldErrors.currentPassword ? (
                            <p className="mt-1 text-xs text-red-600">
                              {editFieldErrors.currentPassword}
                            </p>
                          ) : null}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">
                            Mật khẩu mới
                          </label>
                          <div className="relative">
                            <input
                              type={showNewPwd ? "text" : "password"}
                              value={pwdForm.password}
                              onChange={(e) =>
                                setPwdForm((f) => ({
                                  ...f,
                                  password: e.target.value,
                                }))
                              }
                              className={`w-full px-4 pr-12 py-2.5 border rounded-xl focus:ring-2 focus:ring-primary outline-none ${
                                editFieldErrors.password
                                  ? "border-red-300 bg-red-50/40"
                                  : "border-slate-200"
                              }`}
                              placeholder="Ít nhất 8 ký tự, có hoa/thường/số/ký tự đặc biệt"
                              disabled={editBusy}
                            />
                            <button
                              type="button"
                              onClick={() => setShowNewPwd((v) => !v)}
                              disabled={editBusy}
                              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                              aria-label={
                                showNewPwd ? "Ẩn mật khẩu" : "Hiện mật khẩu"
                              }
                            >
                              {showNewPwd ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                          {editFieldErrors.password ? (
                            <p className="mt-1 text-xs text-red-600">
                              {editFieldErrors.password}
                            </p>
                          ) : null}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">
                            Nhập lại mật khẩu mới
                          </label>
                          <div className="relative">
                            <input
                              type={showConfirmPwd ? "text" : "password"}
                              value={pwdForm.confirmPassword}
                              onChange={(e) =>
                                setPwdForm((f) => ({
                                  ...f,
                                  confirmPassword: e.target.value,
                                }))
                              }
                              className={`w-full px-4 pr-12 py-2.5 border rounded-xl focus:ring-2 focus:ring-primary outline-none ${
                                editFieldErrors.confirmPassword
                                  ? "border-red-300 bg-red-50/40"
                                  : "border-slate-200"
                              }`}
                              placeholder="••••••••"
                              disabled={editBusy}
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPwd((v) => !v)}
                              disabled={editBusy}
                              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                              aria-label={
                                showConfirmPwd ? "Ẩn mật khẩu" : "Hiện mật khẩu"
                              }
                            >
                              {showConfirmPwd ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                          {editFieldErrors.confirmPassword ? (
                            <p className="mt-1 text-xs text-red-600">
                              {editFieldErrors.confirmPassword}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void submitEditProfile()}
                        disabled={editBusy}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl font-semibold hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                      >
                        {editBusy ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        Lưu thay đổi
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditProfile}
                        disabled={editBusy}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                      >
                        <X className="w-4 h-4" />
                        Huỷ
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* STAT CARDS */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            icon={CalendarClock}
            label="Lịch sắp tới gần đây"
            value={String(upcoming.length)}
            tone="sky"
            loading={loadingAppointments}
          />
          <StatCard
            icon={CheckCircle2}
            label="Lượt hoàn tất gần đây"
            value={String(completedCount)}
            tone="emerald"
            loading={loadingAppointments}
          />
          <StatCard
            icon={Receipt}
            label="Đã thanh toán trong danh sách"
            value={String(paidPaymentCount)}
            tone="violet"
            loading={loadingPayments}
          />
          <StatCard
            icon={Wallet}
            label="Đã chi trong danh sách"
            value={formatVnd(totalSpent)}
            tone="amber"
            small
            loading={loadingPayments}
          />
        </section>

        {/* TABS */}
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/40 px-2 sm:px-4">
            <nav className="flex gap-1 overflow-x-auto -mb-px" role="tablist">
              <TabButton
                icon={CalendarClock}
                label="Lịch sắp tới gần đây"
                badge={upcoming.length}
                active={activeTab === "upcoming"}
                onClick={() => setActiveTab("upcoming")}
              />
              <TabButton
                icon={ClipboardList}
                label="Lịch sử khám"
                badge={past.length}
                active={activeTab === "history"}
                onClick={() => setActiveTab("history")}
              />
              <TabButton
                icon={Wallet}
                label="Lịch sử giao dịch"
                badge={payments.length}
                active={activeTab === "payments"}
                onClick={() => setActiveTab("payments")}
              />
            </nav>
          </div>

          <div className="p-5 sm:p-6">
            {activeTab === "upcoming" && (
              <UpcomingTab
                upcoming={upcoming}
                loading={loadingAppointments}
                onNavigate={onNavigate}
                onCancel={openCancelModal}
              />
            )}
            {activeTab === "history" && (
              <HistoryTab
                past={past}
                loading={loadingAppointments}
                onViewRecord={openMedicalRecordModal}
              />
            )}
            {activeTab === "payments" && (
              <>
                <PaymentsTab
                  payments={filteredPayments}
                  loading={loadingPayments}
                  filter={paymentFilter}
                  onChangeFilter={setPaymentFilter}
                  totalCount={payments.length}
                />
                <div className="flex gap-4 items-center mt-4">
                  <button
                    disabled={paymentsPage === 1 || loadingPayments}
                    onClick={() => setPaymentsPage((p) => p - 1)}
                  >
                    Trang trước
                  </button>
                  <span>Trang {paymentsPage}</span>
                  <button
                    disabled={payments.length < 50 || loadingPayments}
                    onClick={() => setPaymentsPage((p) => p + 1)}
                  >
                    Trang sau
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <MedicalRecordModal
        open={recordModalOpen}
        loading={recordLoading}
        error={recordError}
        record={recordData}
        onClose={closeMedicalRecordModal}
      />

      <CancelAppointmentModal
        target={cancelTarget}
        reason={cancelReason}
        onChangeReason={setCancelReason}
        busy={cancelBusy}
        error={cancelError}
        onClose={closeCancelModal}
        onConfirm={submitCancel}
      />
    </div>
  );
};

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: "sky" | "emerald" | "violet" | "amber";
  small?: boolean;
  loading?: boolean;
}

const STAT_TONE: Record<
  StatCardProps["tone"],
  { bg: string; text: string; ring: string }
> = {
  sky: { bg: "bg-sky-50", text: "text-sky-600", ring: "ring-sky-100" },
  emerald: {
    bg: "bg-emerald-50",
    text: "text-emerald-600",
    ring: "ring-emerald-100",
  },
  violet: {
    bg: "bg-violet-50",
    text: "text-violet-600",
    ring: "ring-violet-100",
  },
  amber: { bg: "bg-amber-50", text: "text-amber-600", ring: "ring-amber-100" },
};

const StatCard: React.FC<StatCardProps> = ({
  icon: Icon,
  label,
  value,
  tone,
  small,
  loading,
}) => {
  const t = STAT_TONE[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all">
      <div
        className={`w-10 h-10 rounded-xl ${t.bg} ${t.text} ring-1 ${t.ring} flex items-center justify-center mb-3`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      {loading ? (
        <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
      ) : (
        <p
          className={`font-bold text-slate-900 tabular-nums tracking-tight ${
            small ? "text-base sm:text-lg" : "text-2xl sm:text-3xl"
          }`}
        >
          {value}
        </p>
      )}
    </div>
  );
};

interface TabButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
  active: boolean;
  onClick: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({
  icon: Icon,
  label,
  badge,
  active,
  onClick,
}) => {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative inline-flex items-center gap-2 px-4 sm:px-5 py-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 ${
        active
          ? "text-primary border-primary"
          : "text-slate-500 hover:text-slate-700 border-transparent hover:border-slate-200"
      }`}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span
          className={`min-w-[1.25rem] h-5 px-1.5 inline-flex items-center justify-center text-[11px] font-bold rounded-full tabular-nums ${
            active
              ? "bg-primary/15 text-primary"
              : "bg-slate-200 text-slate-600"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
};

interface UpcomingTabProps {
  upcoming: ApiAppointment[];
  loading: boolean;
  onNavigate?: (view: string) => void;
  onCancel: (apt: ApiAppointment) => void;
}

const UpcomingTab: React.FC<UpcomingTabProps> = ({
  upcoming,
  loading,
  onNavigate,
  onCancel,
}) => {
  if (loading) {
    return (
      <div className="flex justify-center py-16 text-slate-500 text-sm">
        <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
        Đang tải…
      </div>
    );
  }
  if (upcoming.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
        <Stethoscope className="w-10 h-10 mx-auto text-slate-300 mb-3" />
        <p className="text-slate-700 font-medium">Chưa có lịch sắp tới</p>
        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
          Chọn bác sĩ và khung giờ phù hợp — đặt cọc online để giữ chỗ.
        </p>
        <button
          type="button"
          onClick={() => onNavigate?.("search")}
          className="mt-4 px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90"
        >
          Tìm bác sĩ
        </button>
      </div>
    );
  }
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {upcoming.map((apt) => {
        const doctorName = apt.doctor
          ? formatDoctorName(apt.doctor.fullName)
          : "Bác sĩ";
        const specialty = apt.doctor?.departmentName ?? "—";
        const dateLabel = apt.slot
          ? formatAppointmentDateTime(apt.slot.slotTime)
          : "—";
        const paid = apt.status === "confirmed";
        const paymentStatus = paid ? "Đã đặt cọc" : "Chưa thanh toán cọc";
        const avatarSrc = resolveApiAssetUrl(apt.doctor?.avatarUrl);
        const canCancel =
          apt.status === "pending" || apt.status === "confirmed";
        return (
          <div
            key={apt.id}
            className="group rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:border-primary/30 hover:shadow-md transition-all"
          >
            <div className="p-5 flex gap-4">
              <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center ring-2 ring-white shadow-sm">
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-7 h-7 text-slate-400" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 leading-tight truncate">
                      {doctorName}
                    </h3>
                    <p className="text-sm font-medium text-primary mt-0.5 truncate">
                      {specialty}
                    </p>
                  </div>
                  {canCancel && (
                    <button
                      type="button"
                      onClick={() => onCancel(apt)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                      title="Huỷ cuộc hẹn"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 text-slate-600 text-sm">
                  <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="font-medium">{dateLabel}</span>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                    paid
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : "bg-amber-50 text-amber-900 border-amber-200"
                  }`}
                >
                  {paid ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <Clock3 className="w-3.5 h-3.5" />
                  )}
                  {paymentStatus}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface HistoryTabProps {
  past: ApiAppointment[];
  loading: boolean;
  onViewRecord: (appointmentId: string) => void;
}

const HistoryTab: React.FC<HistoryTabProps> = ({
  past,
  loading,
  onViewRecord,
}) => {
  if (loading) {
    return (
      <div className="flex justify-center py-16 text-slate-500 text-sm">
        <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
        Đang tải…
      </div>
    );
  }
  if (past.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-sm text-slate-500">
        Chưa có lịch nào đã qua. Sau khi khám, trạng thái sẽ cập nhật theo dữ
        liệu từ hệ thống.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto -mx-5 sm:-mx-6">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-slate-50/70 border-y border-slate-100">
            <th className="px-5 sm:px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">
              Bác sĩ
            </th>
            <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">
              Ngày giờ
            </th>
            <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">
              Triệu chứng / lý do
            </th>
            <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">
              Trạng thái
            </th>
            <th className="px-5 sm:px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide text-right">
              Kết quả khám
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {past.map((apt) => {
            const doctorName = apt.doctor
              ? formatDoctorName(apt.doctor.fullName)
              : "—";
            const dateStr =
              apt.slot?.slotTime != null
                ? formatHistoryDate(apt.slot.slotTime)
                : "—";
            const timeStr =
              apt.slot?.slotTime != null
                ? new Date(apt.slot.slotTime).toLocaleTimeString("vi-VN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "";
            const reason = apt.symptoms?.trim() || "—";
            const st = appointmentStatusPresentation(apt.status);
            const cancelReason = apt.cancelReason?.trim() || null;
            const isAutoExpired = cancelReason?.startsWith("auto-expired");
            const cancelLabel = isAutoExpired
              ? "Tự huỷ do quá hạn thanh toán cọc"
              : cancelReason;
            return (
              <tr
                key={apt.id}
                className="hover:bg-slate-50/60 transition-colors"
              >
                <td className="px-5 sm:px-6 py-4 font-semibold text-slate-900">
                  {doctorName}
                </td>
                <td className="px-5 py-4 text-slate-600 whitespace-nowrap">
                  {dateStr}
                  {timeStr ? (
                    <>
                      <br />
                      <span className="text-slate-500">{timeStr}</span>
                    </>
                  ) : null}
                </td>
                <td
                  className="px-5 py-4 text-slate-600 max-w-[14rem] truncate"
                  title={reason}
                >
                  {reason}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-bold ${st.className}`}
                    title={cancelLabel ? `Lý do: ${cancelLabel}` : undefined}
                  >
                    {st.label}
                  </span>
                  {apt.status.toLowerCase() === "cancelled" && cancelLabel && (
                    <p
                      className="mt-1 text-[11px] text-slate-500 max-w-[14rem] truncate italic"
                      title={cancelLabel}
                    >
                      {cancelLabel}
                    </p>
                  )}
                </td>
                <td className="px-5 sm:px-6 py-4 text-right whitespace-nowrap">
                  {apt.hasMedicalRecord ? (
                    <button
                      type="button"
                      onClick={() => onViewRecord(apt.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-white border border-primary/20 hover:border-primary text-xs font-bold transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Xem kết quả
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400 italic">
                      Chưa có
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

interface MedicalRecordModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  record: ApiPatientMedicalRecord | null;
  onClose: () => void;
}

const MedicalRecordModal: React.FC<MedicalRecordModalProps> = ({
  open,
  loading,
  error,
  record,
  onClose,
}) => {
  return (
    <ModalOverlay open={open} onClose={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="relative px-6 sm:px-8 pt-6 pb-4 border-b border-slate-100 bg-gradient-to-br from-primary/5 via-sky-50/40 to-white">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary/10 ring-1 ring-primary/20 text-primary flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-slate-900">Kết quả khám</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Hồ sơ bác sĩ ghi sau buổi khám của bạn
              </p>
            </div>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-sm gap-3">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
              Đang tải kết quả khám…
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center">
                <AlertCircle className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-800">
                Không tải được kết quả
              </p>
              <p className="text-xs text-slate-500 max-w-sm">{error}</p>
            </div>
          ) : record ? (
            <div className="space-y-5">
              <RecordHeader record={record} />
              <RecordSection
                icon={Activity}
                tone="sky"
                label="Triệu chứng"
                value={record.symptoms}
              />
              <RecordSection
                icon={Stethoscope}
                tone="violet"
                label="Chẩn đoán"
                value={record.diagnosis}
              />
              <RecordSection
                icon={Pill}
                tone="emerald"
                label="Phác đồ điều trị"
                value={record.treatment}
              />
              <RecordSection
                icon={StickyNote}
                tone="amber"
                label="Ghi chú từ bác sĩ"
                value={record.notes}
              />
            </div>
          ) : null}
        </div>

        <div className="px-6 sm:px-8 py-4 border-t border-slate-100 bg-slate-50/40 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 hover:border-slate-300"
          >
            Đóng
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};

const RecordHeader: React.FC<{ record: ApiPatientMedicalRecord }> = ({
  record,
}) => {
  const doctorName = record.doctor
    ? formatDoctorName(record.doctor.fullName)
    : "Bác sĩ";
  const dept = record.doctor?.departmentName ?? null;
  const slotIso = record.slotTime;
  const slotLabel = slotIso ? formatFullDateTimeVi(slotIso) : null;
  const createdLabel = formatFullDateTimeVi(record.createdAt);
  const avatar = resolveApiAssetUrl(record.doctor?.avatarUrl);
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 flex gap-3 items-start">
      <div className="w-12 h-12 rounded-xl overflow-hidden bg-white ring-2 ring-white shadow-sm shrink-0 flex items-center justify-center">
        {avatar ? (
          <img src={avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          <User className="w-6 h-6 text-slate-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-slate-900 leading-tight truncate">
          {doctorName}
        </p>
        {dept ? (
          <p className="text-xs text-primary font-semibold mt-0.5">{dept}</p>
        ) : null}
        <div className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
          {slotLabel ? (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>
                Ngày khám:{" "}
                <strong className="text-slate-800">{slotLabel}</strong>
              </span>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>
              Lập hồ sơ:{" "}
              <strong className="text-slate-800">{createdLabel}</strong>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
};

interface CancelAppointmentModalProps {
  target: ApiAppointment | null;
  reason: string;
  onChangeReason: (v: string) => void;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

const CancelAppointmentModal: React.FC<CancelAppointmentModalProps> = ({
  target,
  reason,
  onChangeReason,
  busy,
  error,
  onClose,
  onConfirm,
}) => {
  const open = Boolean(target);
  const isPaid = target?.status === "confirmed";
  const doctorName = target?.doctor
    ? formatDoctorName(target.doctor.fullName)
    : "Bác sĩ";
  const dateLabel = target?.slot
    ? formatAppointmentDateTime(target.slot.slotTime)
    : "—";

  return (
    <ModalOverlay open={open} onClose={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="relative px-6 pt-6 pb-4 border-b border-slate-100 bg-gradient-to-br from-red-50 via-amber-50/40 to-white">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-red-100 ring-1 ring-red-200 text-red-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-slate-900">
                Huỷ cuộc hẹn?
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Hành động không thể hoàn tác
              </p>
            </div>
          </div>
          <ModalCloseButton onClose={onClose} disabled={busy} />
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">{doctorName}</p>
            {target?.doctor?.departmentName && (
              <p className="text-xs text-primary mt-0.5">
                {target.doctor.departmentName}
              </p>
            )}
            <p className="text-xs text-slate-600 mt-1.5">
              <Calendar className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5 text-slate-400" />
              {dateLabel}
            </p>
          </div>

          {isPaid ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-bold text-amber-900">
                Cảnh báo: Mất tiền cọc
              </p>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                Cuộc hẹn này đã được đặt cọc thành công. Theo chính sách hiện
                tại, **huỷ lịch sẽ mất tiền cọc** (cọc đã trả là phí giữ chỗ,
                không hoàn lại).
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-700 leading-relaxed">
                Cuộc hẹn này chưa thanh toán cọc, huỷ ngay sẽ không phát sinh
                phí.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-700">
              Lý do huỷ{" "}
              <span className="text-slate-400 font-normal">(tuỳ chọn)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => onChangeReason(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={busy}
              placeholder="VD: Bận đột xuất, đổi ý, đặt nhầm khung giờ…"
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-red-300 focus:border-red-300 outline-none resize-none disabled:bg-slate-50"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/40 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Quay lại
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            {isPaid ? "Huỷ và mất cọc" : "Xác nhận huỷ"}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};

interface RecordSectionProps {
  icon: React.ComponentType<{ className?: string }>;
  tone: "sky" | "violet" | "emerald" | "amber";
  label: string;
  value: string | null;
}

const RECORD_TONE: Record<
  RecordSectionProps["tone"],
  { bg: string; text: string; ring: string }
> = {
  sky: { bg: "bg-sky-50", text: "text-sky-700", ring: "ring-sky-100" },
  violet: {
    bg: "bg-violet-50",
    text: "text-violet-700",
    ring: "ring-violet-100",
  },
  emerald: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    ring: "ring-emerald-100",
  },
  amber: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-100" },
};

const RecordSection: React.FC<RecordSectionProps> = ({
  icon: Icon,
  tone,
  label,
  value,
}) => {
  const t = RECORD_TONE[tone];
  const isEmpty = !value || !value.trim();
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`w-7 h-7 rounded-lg ${t.bg} ${t.text} ring-1 ${t.ring} inline-flex items-center justify-center`}
        >
          <Icon className="w-4 h-4" />
        </span>
        <h4 className="text-sm font-bold text-slate-800">{label}</h4>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
        {isEmpty ? (
          <span className="italic text-slate-400">
            Bác sĩ không ghi nội dung này
          </span>
        ) : (
          value
        )}
      </div>
    </div>
  );
};

interface PaymentsTabProps {
  payments: ApiPaymentHistoryItem[];
  loading: boolean;
  filter: PaymentFilter;
  onChangeFilter: (f: PaymentFilter) => void;
  totalCount: number;
}

const PAYMENT_FILTERS: { id: PaymentFilter; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "paid", label: "Đã thanh toán" },
  { id: "pending", label: "Đang chờ" },
  { id: "failed", label: "Thất bại" },
];

const PaymentsTab: React.FC<PaymentsTabProps> = ({
  payments,
  loading,
  filter,
  onChangeFilter,
  totalCount,
}) => {
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="inline-flex items-center gap-1.5 text-sm text-slate-500">
          <Filter className="w-4 h-4" />
          <span>Lọc theo trạng thái</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PAYMENT_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onChangeFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                filter === f.id
                  ? "bg-primary text-white border-primary"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-slate-500 text-sm">
          <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
          Đang tải…
        </div>
      ) : totalCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
          <Wallet className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-700 font-medium">Chưa có giao dịch nào</p>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            Khi bạn đặt lịch và thanh toán cọc qua PayOS, các giao dịch sẽ hiển
            thị tại đây.
          </p>
        </div>
      ) : payments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
          <XCircle className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-700 font-medium">
            Không có giao dịch nào khớp bộ lọc hiện tại
          </p>
          <button
            type="button"
            onClick={() => onChangeFilter("all")}
            className="mt-4 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5 rounded-lg"
          >
            Xem tất cả
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {payments.map((p) => (
            <PaymentRow key={p.id} payment={p} />
          ))}
        </ul>
      )}
    </div>
  );
};

const PaymentRow: React.FC<{ payment: ApiPaymentHistoryItem }> = ({
  payment,
}) => {
  const st = paymentStatusPresentation(payment.status);
  const doctorName = payment.appointment?.doctor
    ? formatDoctorName(payment.appointment.doctor.fullName)
    : null;
  const department = payment.appointment?.doctor?.departmentName ?? null;
  const slotLabel = payment.appointment?.slotTime
    ? formatFullDateTimeVi(payment.appointment.slotTime)
    : null;
  const createdLabel = formatFullDateTimeVi(payment.createdAt);
  const avatarSrc = resolveApiAssetUrl(
    payment.appointment?.doctor?.avatarUrl ?? null,
  );

  return (
    <li className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:border-slate-300 hover:shadow-md transition-all">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center ring-1 ring-slate-100">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <Receipt className="w-6 h-6 text-slate-400" />
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="font-bold text-slate-900 truncate">
                  {paymentTypeLabel(payment.paymentType)}
                </h3>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${st.badgeClass}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${st.dotClass}`} />
                  {st.label}
                </span>
              </div>
            </div>

            {doctorName && (
              <p className="text-sm text-slate-700">
                <span className="font-medium">{doctorName}</span>
                {department && (
                  <span className="text-slate-500"> · {department}</span>
                )}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Receipt className="w-3.5 h-3.5" />
                {payment.payosOrderCode != null ? (
                  <>
                    Mã đơn:{" "}
                    <span className="font-semibold text-slate-700 tabular-nums">
                      {payment.payosOrderCode}
                    </span>
                  </>
                ) : (
                  <span className="italic">Không có mã đơn</span>
                )}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock3 className="w-3.5 h-3.5" />
                <span>Tạo lúc {createdLabel}</span>
              </span>
              {slotLabel && (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Lịch khám: {slotLabel}</span>
                </span>
              )}
              {payment.paymentMethod && (
                <span className="inline-flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5" />
                  <span className="uppercase tracking-wide">
                    {payment.paymentMethod}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="text-right shrink-0 sm:pl-4 sm:border-l sm:border-slate-100">
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              Số tiền
            </p>
            <p
              className={`text-lg sm:text-xl font-bold tabular-nums ${
                payment.status === "failed"
                  ? "text-slate-400 line-through"
                  : "text-slate-900"
              }`}
            >
              {formatVnd(payment.amount)}
            </p>
          </div>
        </div>
      </div>
    </li>
  );
};
