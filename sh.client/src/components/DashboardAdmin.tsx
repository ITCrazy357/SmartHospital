import React, { useState, useEffect, useMemo } from "react";
import {
  Building2,
  Stethoscope,
  Plus,
  Pencil,
  Trash2,
  Search,
  Loader2,
  Palmtree,
  Check,
  X,
  Users,
  KeyRound,
  CreditCard,
  BarChart3,
  Megaphone,
  BellRing,
  Sparkles,
  Settings,
} from "lucide-react";
import {
  api,
  ApiRequestError,
  getStoredUser,
  type ApiAuthUser,
  type ApiUpdateDoctorBody,
  type ApiDepartment,
  type ApiDoctor,
  type ApiCreateDoctorBody,
  type ApiDoctorLeaveRequest,
  type ApiAdminPaymentRow,
  type ApiAdminStatsOverview,
  type ApiAdminAiUsageStats,
} from "../api/client";
import { useToast } from "../contexts/ToastContext";
import { AvatarPicker } from "./AvatarPicker";
import { validateStrongPassword } from "../utils/patient-register.validation";
import {
  formatWorkdaysShortVi,
  listWeekdayIsoDatesInRange,
} from "../utils/weekdayCalendar";
import { formatDoctorName } from "../utils/formatDoctorName";
import { ModalCloseButton, ModalOverlay } from "./ModalOverlay";
import { AdsManager } from "./admin/AdsManager";
import { AiUsageDailyChart } from "./admin/AiUsageDailyChart";
import { ListPagination } from "./ListPagination";
import { usePagination, PAGE_SIZE } from "../utils/usePagination";

type Tab =
  | "departments"
  | "leave"
  | "users"
  | "payments"
  | "stats"
  | "ads"
  | "ai"
  | "config";
type UserRoleFilter =
  | "all"
  | "user"
  | "doctor"
  | "admin"
  | "receptionist"
  | "cashier";
type AdminReportPreset = "7d" | "30d" | "90d" | "custom";

function isoDateOnlyLocal(d: Date): string {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return tz.toISOString().slice(0, 10);
}

function adminStatsPresetRange(preset: Exclude<AdminReportPreset, "custom">): {
  from: string;
  to: string;
} {
  const today = isoDateOnlyLocal(new Date());
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const fromD = new Date();
  fromD.setDate(fromD.getDate() - (days - 1));
  return { from: isoDateOnlyLocal(fromD), to: today };
}

const ADMIN_STATS_PRESETS: {
  id: Exclude<AdminReportPreset, "custom">;
  label: string;
}[] = [
  { id: "7d", label: "7 ngày" },
  { id: "30d", label: "30 ngày" },
  { id: "90d", label: "90 ngày" },
];

function formatShortDateVi(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

/** Nhãn trục ngang DD/MM từ YYYY-MM-DD */
function formatDayMonthVi(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}`;
}

const moneyFmtVnd = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
});

function paymentStatusLabelVi(s: ApiAdminPaymentRow["status"]): string {
  if (s === "paid") return "Đã thanh toán";
  if (s === "pending") return "Đang chờ";
  if (s === "failed") return "Thất bại";
  return s;
}

function appointmentStatusLabelVi(s: string): string {
  if (s === "pending") return "Chờ xác nhận";
  if (s === "confirmed") return "Đã xác nhận";
  if (s === "completed") return "Hoàn thành";
  if (s === "cancelled") return "Đã hủy";
  return s;
}

function paymentTypeLabelVi(t: string | null): string {
  if (!t) return "—";
  if (t === "deposit") return "Đặt cọc";
  if (t === "full") return "Thanh toán đủ";
  return t;
}

function formatPaymentDtVi(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Đồng bộ cách so sánh tên khoa với sh.server DepartmentsService.deptNameCanonical */
function canonicalDepartmentName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKC")
    .toLocaleLowerCase("vi-VN");
}

export const DashboardAdmin: React.FC = () => {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("departments");
  const [departments, setDepartments] = useState<ApiDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Khoa: form thêm/sửa
  const [deptFormOpen, setDeptFormOpen] = useState(false);
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [deptName, setDeptName] = useState("");
  const [deptDesc, setDeptDesc] = useState("");
  const [deptSubmitting, setDeptSubmitting] = useState(false);
  const [deptFieldError, setDeptFieldError] = useState<string | null>(null);
  const [deptSearch, setDeptSearch] = useState("");

  // Bác sĩ: form thêm
  const [doctorFormOpen, setDoctorFormOpen] = useState(false);
  const [doctorForm, setDoctorForm] = useState<ApiCreateDoctorBody>({
    email: "",
    password: "",
    fullName: "",
    phone: "",
    departmentId: null,
    university: null,
    bio: null,
    experienceYears: null,
  });
  const [doctorSubmitting, setDoctorSubmitting] = useState(false);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [doctorFieldErrors, setDoctorFieldErrors] = useState<Record<
    string,
    string
  > | null>(null);
  const [doctorAvatarFile, setDoctorAvatarFile] = useState<File | null>(null);

  const [leaveList, setLeaveList] = useState<ApiDoctorLeaveRequest[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<"pending" | "all">(
    "pending",
  );

  const [users, setUsers] = useState<ApiAuthUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userRoleFilter, setUserRoleFilter] = useState<UserRoleFilter>("all");

  const [editDoctorOpen, setEditDoctorOpen] = useState(false);
  const [editDoctorId, setEditDoctorId] = useState<string | null>(null);
  const [editDoctorForm, setEditDoctorForm] = useState<ApiUpdateDoctorBody>({
    email: "",
    fullName: "",
    phone: "",
    departmentId: null,
    university: null,
    bio: null,
    experienceYears: null,
  });
  const [editDoctorAvatar, setEditDoctorAvatar] = useState<File | null>(null);
  const [editDoctorError, setEditDoctorError] = useState<string | null>(null);
  const [editDoctorSubmitting, setEditDoctorSubmitting] = useState(false);
  const [editDoctorLoading, setEditDoctorLoading] = useState(false);

  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [pwdDoctorId, setPwdDoctorId] = useState<string | null>(null);
  const [pwdDoctorName, setPwdDoctorName] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdFieldErrors, setPwdFieldErrors] = useState<Record<
    string,
    string
  > | null>(null);
  const [pwdSubmitting, setPwdSubmitting] = useState(false);

  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createUserRole, setCreateUserRole] = useState<
    "user" | "admin" | "receptionist" | "cashier"
  >("user");
  const [createUserForm, setCreateUserForm] = useState({
    email: "",
    password: "",
    fullName: "",
    phone: "",
  });
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [createUserSubmitting, setCreateUserSubmitting] = useState(false);

  const [adminReportPreset, setAdminReportPreset] =
    useState<AdminReportPreset>("30d");
  const [adminReportFrom, setAdminReportFrom] = useState(
    () => adminStatsPresetRange("30d").from,
  );
  const [adminReportTo, setAdminReportTo] = useState(
    () => adminStatsPresetRange("30d").to,
  );
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<
    "all" | "pending" | "paid" | "failed"
  >("all");
  const [adminPayments, setAdminPayments] = useState<ApiAdminPaymentRow[]>([]);
  const [adminPaymentsLoading, setAdminPaymentsLoading] = useState(false);
  const [adminStats, setAdminStats] = useState<ApiAdminStatsOverview | null>(
    null,
  );
  const [adminStatsLoading, setAdminStatsLoading] = useState(false);

  // AI cost tracking
  const [aiUsage, setAiUsage] = useState<ApiAdminAiUsageStats | null>(null);
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [aiReportPreset, setAiReportPreset] =
    useState<AdminReportPreset>("30d");
  const [aiReportFrom, setAiReportFrom] = useState(
    () => adminStatsPresetRange("30d").from,
  );
  const [aiReportTo, setAiReportTo] = useState(
    () => adminStatsPresetRange("30d").to,
  );

  // Cấu hình hệ thống
  const [depositAmount, setDepositAmountState] = useState<number>(50_000);
  const [depositInput, setDepositInput] = useState("50000");
  const [depositSaving, setDepositSaving] = useState(false);

  // Job nhắc lịch (gửi email H-24 / H-1) — admin có thể chạy thủ công.
  const [reminderRunning, setReminderRunning] = useState(false);
  const [reminderResult, setReminderResult] = useState<{
    h24Sent: number;
    h1Sent: number;
    h24Failed: number;
    h1Failed: number;
    skipped: number;
    at: number;
  } | null>(null);
  // Form gửi mail TEST cho 1 appointment cụ thể (bỏ qua cửa sổ thời gian).
  const [testApptId, setTestApptId] = useState("");
  const [testKind, setTestKind] = useState<"h24" | "h1">("h1");
  const [testSending, setTestSending] = useState(false);

  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [lockTarget, setLockTarget] = useState<{
    id: string;
    name: string;
    locked: boolean;
  } | null>(null);
  const [lockSubmitting, setLockSubmitting] = useState(false);

  const handleSendTestReminder = async () => {
    const id = testApptId.trim();
    if (!id) {
      toast.error("Vui lòng nhập ID cuộc hẹn cần test.");
      return;
    }
    setTestSending(true);
    try {
      const res = await api.sendAppointmentReminderTest(id, testKind);
      toast.success(
        `Đã gửi mail test (${res.kind.toUpperCase()}) đến ${res.to}.`,
      );
    } catch (e) {
      toast.error(
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Không gửi được mail test.",
      );
    } finally {
      setTestSending(false);
    }
  };

  const handleRunReminders = async () => {
    if (reminderRunning) return;
    setReminderRunning(true);
    try {
      const res = await api.runAppointmentReminders();
      setReminderResult({ ...res, at: Date.now() });
      const totalSent = res.h24Sent + res.h1Sent;
      const totalFailed = res.h24Failed + res.h1Failed;
      if (totalSent === 0 && totalFailed === 0) {
        toast.success("Không có cuộc hẹn nào cần nhắc trong khung giờ này.");
      } else if (totalFailed === 0) {
        toast.success(
          `Đã gửi ${totalSent} email nhắc lịch (H-24: ${res.h24Sent}, H-1: ${res.h1Sent}).`,
        );
      } else {
        toast.error(
          `Gửi ${totalSent} thành công, ${totalFailed} lỗi. Kiểm tra log server.`,
        );
      }
    } catch (e) {
      toast.error(
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Không chạy được job nhắc lịch.",
      );
    } finally {
      setReminderRunning(false);
    }
  };

  const currentAdminId = getStoredUser()?.id;

  const loadLeaveRequests = () => {
    setLeaveLoading(true);
    const q = leaveStatusFilter === "pending" ? "pending" : undefined;
    api
      .getAdminLeaveRequests(q)
      .then(setLeaveList)
      .catch(() => setLeaveList([]))
      .finally(() => setLeaveLoading(false));
  };

  const loadDepartments = () => {
    api
      .getDepartments()
      .then(setDepartments)
      .catch(() => setDepartments([]));
  };

  const loadUsers = () => {
    setUsersLoading(true);
    const role = userRoleFilter === "all" ? undefined : userRoleFilter;
    api
      .getAdminUsers(role)
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getDepartments()
      .then(setDepartments)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Không tải được dữ liệu"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab === "departments") loadDepartments();
    else if (tab === "leave") loadLeaveRequests();
    else if (tab === "users") loadUsers();
  }, [tab, leaveStatusFilter, userRoleFilter]);

  useEffect(() => {
    if (tab !== "payments") return;
    setAdminPaymentsLoading(true);
    api
      .getAdminPayments({
        from: adminReportFrom,
        to: adminReportTo,
        status: paymentStatusFilter === "all" ? undefined : paymentStatusFilter,
      })
      .then(setAdminPayments)
      .catch(() => setAdminPayments([]))
      .finally(() => setAdminPaymentsLoading(false));
  }, [tab, adminReportFrom, adminReportTo, paymentStatusFilter]);

  useEffect(() => {
    if (tab !== "stats") return;
    setAdminStatsLoading(true);
    api
      .getAdminStatsOverview(adminReportFrom, adminReportTo)
      .then(setAdminStats)
      .catch(() => setAdminStats(null))
      .finally(() => setAdminStatsLoading(false));
  }, [tab, adminReportFrom, adminReportTo]);

  useEffect(() => {
    if (tab !== "ai") return;
    setAiUsageLoading(true);
    api
      .getAdminAiUsageStats(aiReportFrom, aiReportTo)
      .then(setAiUsage)
      .catch(() => setAiUsage(null))
      .finally(() => setAiUsageLoading(false));
  }, [tab, aiReportFrom, aiReportTo]);

  useEffect(() => {
    if (tab !== "config") return;
    api
      .getAdminConfig()
      .then((r) => {
        setDepositAmountState(r.depositAmount);
        setDepositInput(String(r.depositAmount));
      })
      .catch(() => {});
  }, [tab]);

  const applyAiReportPreset = (p: Exclude<AdminReportPreset, "custom">) => {
    const r = adminStatsPresetRange(p);
    setAiReportPreset(p);
    setAiReportFrom(r.from);
    setAiReportTo(r.to);
  };

  const setAiReportCustom = (patch: { from?: string; to?: string }) => {
    setAiReportPreset("custom");
    if (patch.from !== undefined) setAiReportFrom(patch.from);
    if (patch.to !== undefined) setAiReportTo(patch.to);
  };

  const applyAdminReportPreset = (p: Exclude<AdminReportPreset, "custom">) => {
    const r = adminStatsPresetRange(p);
    setAdminReportPreset(p);
    setAdminReportFrom(r.from);
    setAdminReportTo(r.to);
  };

  const setAdminReportCustom = (next: { from?: string; to?: string }) => {
    setAdminReportPreset("custom");
    if (next.from !== undefined) setAdminReportFrom(next.from);
    if (next.to !== undefined) setAdminReportTo(next.to);
  };

  const filteredDepartments = useMemo(() => {
    const q = deptSearch.trim().toLocaleLowerCase("vi-VN");
    if (!q) return departments;
    return departments.filter((d) => {
      const name = d.name.toLocaleLowerCase("vi-VN");
      const desc = (d.description ?? "").toLocaleLowerCase("vi-VN");
      return name.includes(q) || desc.includes(q);
    });
  }, [departments, deptSearch]);

  const deptPagination = usePagination(
    filteredDepartments,
    PAGE_SIZE.departments,
    deptSearch,
  );
  const usersPagination = usePagination(users, PAGE_SIZE.table, userRoleFilter);
  const paymentsPagination = usePagination(
    adminPayments,
    PAGE_SIZE.table,
    `${paymentStatusFilter}-${adminReportFrom}-${adminReportTo}`,
  );
  const leavePagination = usePagination(
    leaveList,
    PAGE_SIZE.table,
    leaveStatusFilter,
  );

  const maxRevenueDay = useMemo(() => {
    if (!adminStats?.revenueByDay?.length) return 0;
    return Math.max(...adminStats.revenueByDay.map((d) => d.total));
  }, [adminStats]);

  /** Bước nhãn trục X — tránh chồng chữ khi kỳ dài (90 ngày…) */
  const adminChartLabelStride = useMemo(() => {
    const n = adminStats?.revenueByDay?.length ?? 0;
    if (n <= 18) return 1;
    return Math.max(1, Math.ceil(n / 14));
  }, [adminStats?.revenueByDay?.length]);

  const showAdminChartTick = (
    index: number,
    total: number,
    stride: number,
  ): boolean => {
    if (total <= 0) return false;
    if (total <= 18) return true;
    if (index === 0 || index === total - 1) return true;
    return index % stride === 0;
  };

  const openAddDept = () => {
    setEditingDeptId(null);
    setDeptName("");
    setDeptDesc("");
    setDeptFieldError(null);
    setDeptFormOpen(true);
  };

  const openEditDept = (d: ApiDepartment) => {
    setEditingDeptId(d.id);
    setDeptName(d.name);
    setDeptDesc(d.description ?? "");
    setDeptFieldError(null);
    setDeptFormOpen(true);
  };

  const closeDeptForm = () => {
    setDeptFormOpen(false);
    setDeptFieldError(null);
  };

  const submitDept = async () => {
    const name = deptName.trim();
    if (!name) {
      const msg = "Tên khoa không được để trống.";
      setDeptFieldError(msg);
      toast.error(msg);
      return;
    }
    const key = canonicalDepartmentName(name);
    const dupLocal = departments.some(
      (d) => d.id !== editingDeptId && canonicalDepartmentName(d.name) === key,
    );
    if (dupLocal) {
      const msg = "Tên khoa đã tồn tại.";
      setDeptFieldError(msg);
      toast.error(msg);
      return;
    }

    setDeptFieldError(null);
    setDeptSubmitting(true);
    try {
      if (editingDeptId) {
        await api.updateDepartment(editingDeptId, {
          name,
          description: deptDesc.trim() || null,
        });
        toast.success("Đã cập nhật khoa.");
      } else {
        await api.createDepartment({
          name,
          description: deptDesc.trim() || null,
        });
        toast.success("Đã thêm khoa mới.");
      }
      closeDeptForm();
      loadDepartments();
    } catch (e) {
      const msg =
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Lỗi lưu khoa";
      setDeptFieldError(msg);
      toast.error(msg);
    } finally {
      setDeptSubmitting(false);
    }
  };

  const deleteDept = async (id: string) => {
    if (!window.confirm("Bạn có chắc muốn xóa khoa này?")) return;
    try {
      await api.deleteDepartment(id);
      toast.success("Đã xóa khoa.");
      loadDepartments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không vô hiệu hóa được khoa");
    }
  };

  const openAddDoctor = () => {
    setDoctorForm({
      email: "",
      password: "",
      fullName: "",
      phone: "",
      departmentId: departments[0]?.id ?? null,
      university: null,
      bio: null,
      experienceYears: null,
    });
    setDoctorError(null);
    setDoctorFieldErrors(null);
    setDoctorAvatarFile(null);
    setDoctorFormOpen(true);
  };

  const approveLeave = async (id: string) => {
    try {
      await api.approveLeaveRequest(id);
      toast.success(
        "Đã duyệt nghỉ phép. Các ca trống trong khoảng ngày đã chuyển sang nghỉ phép.",
      );
      loadLeaveRequests();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không duyệt được");
    }
  };

  const rejectLeave = async (id: string) => {
    if (!window.confirm("Từ chối đơn nghỉ phép này?")) return;
    try {
      await api.rejectLeaveRequest(id);
      toast.success("Đã từ chối đơn.");
      loadLeaveRequests();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không từ chối được");
    }
  };

  const submitDoctor = async () => {
    if (
      !doctorForm.email.trim() ||
      !doctorForm.password ||
      !doctorForm.fullName.trim()
    ) {
      setDoctorError("Vui lòng nhập email, mật khẩu và họ tên.");
      return;
    }
    if (doctorForm.experienceYears != null && doctorForm.experienceYears < 0) {
      setDoctorError("Số năm kinh nghiệm không được âm.");
      return;
    }
    setDoctorSubmitting(true);
    setDoctorError(null);
    setDoctorFieldErrors(null);
    try {
      await api.createDoctor(
        {
          ...doctorForm,
          phone: doctorForm.phone || undefined,
          departmentId: doctorForm.departmentId || undefined,
          university: doctorForm.university || undefined,
          bio: doctorForm.bio || undefined,
          experienceYears: doctorForm.experienceYears ?? undefined,
        },
        doctorAvatarFile,
      );
      setDoctorFormOpen(false);
      loadUsers();
      toast.success("Đã thêm bác sĩ và tạo lịch trống (T2–T6).");
    } catch (e) {
      if (
        e instanceof ApiRequestError &&
        e.fieldErrors &&
        Object.keys(e.fieldErrors).length > 0
      ) {
        setDoctorFieldErrors(e.fieldErrors);
        setDoctorError(null);
      } else {
        setDoctorError(
          e instanceof Error ? e.message : "Không tạo được tài khoản bác sĩ",
        );
      }
    } finally {
      setDoctorSubmitting(false);
    }
  };

  const openEditDoctor = async (d: ApiDoctor) => {
    setEditDoctorError(null);
    setEditDoctorLoading(true);
    try {
      const { user } = await api.getAdminDoctor(d.id);
      setEditDoctorForm({
        email: user.email,
        fullName: user.fullName,
        phone: user.phone ?? "",
        departmentId: user.departmentId ?? null,
        university: user.university ?? null,
        bio: user.bio ?? null,
        experienceYears: user.experienceYears ?? null,
      });
      setEditDoctorId(d.id);
      setEditDoctorAvatar(null);
      setEditDoctorOpen(true);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Không tải được thông tin bác sĩ",
      );
    } finally {
      setEditDoctorLoading(false);
    }
  };

  const submitEditDoctor = async () => {
    if (
      !editDoctorId ||
      !editDoctorForm.email.trim() ||
      !editDoctorForm.fullName.trim()
    ) {
      setEditDoctorError("Vui lòng nhập email và họ tên.");
      return;
    }
    setEditDoctorSubmitting(true);
    setEditDoctorError(null);
    try {
      await api.updateDoctor(
        editDoctorId,
        {
          ...editDoctorForm,
          phone: editDoctorForm.phone || null,
          departmentId: editDoctorForm.departmentId || null,
          university: editDoctorForm.university || null,
          bio: editDoctorForm.bio || null,
        },
        editDoctorAvatar,
      );
      setEditDoctorOpen(false);
      loadUsers();
      toast.success("Đã cập nhật thông tin bác sĩ.");
    } catch (e) {
      setEditDoctorError(
        e instanceof Error ? e.message : "Không cập nhật được",
      );
    } finally {
      setEditDoctorSubmitting(false);
    }
  };

  const submitPwdDoctor = async () => {
    if (!pwdDoctorId) return;
    setPwdError(null);
    setPwdFieldErrors(null);
    const fe: Record<string, string> = {};
    const pe = validateStrongPassword(pwdNew);
    if (pe) fe.password = pe;
    if (pwdNew !== pwdConfirm)
      fe.confirmPassword = "Mật khẩu nhập lại không khớp";
    if (Object.keys(fe).length > 0) {
      setPwdFieldErrors(fe);
      return;
    }
    setPwdSubmitting(true);
    try {
      const res = await api.adminSetUserPassword(pwdDoctorId, {
        password: pwdNew,
        confirmPassword: pwdConfirm,
      });
      toast.success(res.message);
      setPwdModalOpen(false);
    } catch (e) {
      if (e instanceof ApiRequestError && e.fieldErrors)
        setPwdFieldErrors(e.fieldErrors);
      else
        setPwdError(e instanceof Error ? e.message : "Không đổi được mật khẩu");
    } finally {
      setPwdSubmitting(false);
    }
  };

  const openPwdAnyUser = (u: ApiAuthUser) => {
    setPwdDoctorId(u.id);
    setPwdDoctorName(
      u.role === "doctor" ? formatDoctorName(u.fullName) : u.fullName,
    );
    setPwdNew("");
    setPwdConfirm("");
    setPwdError(null);
    setPwdFieldErrors(null);
    setPwdModalOpen(true);
  };

  const openCreateManagedUser = () => {
    setCreateUserForm({ email: "", password: "", fullName: "", phone: "" });
    setCreateUserError(null);
    setCreateUserOpen(true);
  };

  const submitCreateManagedUser = async () => {
    const em = createUserForm.email.trim();
    const pw = createUserForm.password;
    const fn = createUserForm.fullName.trim();
    if (!em || !pw || !fn) {
      setCreateUserError("Nhập đủ email, mật khẩu và họ tên.");
      return;
    }
    const pe = validateStrongPassword(pw);
    if (pe) {
      setCreateUserError(pe);
      return;
    }
    setCreateUserSubmitting(true);
    setCreateUserError(null);
    try {
      await api.adminCreateUser({
        email: em,
        password: pw,
        fullName: fn,
        phone:
          createUserForm.phone.trim() === ""
            ? null
            : createUserForm.phone.trim(),
        role: createUserRole,
      });
      toast.success("Đã tạo tài khoản.");
      setCreateUserOpen(false);
      loadUsers();
    } catch (e) {
      setCreateUserError(
        e instanceof Error ? e.message : "Không tạo được tài khoản",
      );
    } finally {
      setCreateUserSubmitting(false);
    }
  };

  const deleteManagedUserRow = async (u: ApiAuthUser) => {
    if (
      !window.confirm(
        `Vô hiệu hóa tài khoản ${u.email}? Hồ sơ và giao dịch được giữ nguyên.`,
      )
    )
      return;
    try {
      await api.adminDeleteUser(u.id);
      toast.success("Đã vô hiệu hóa tài khoản.");
      loadUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không vô hiệu hóa được");
    }
  };

  const toggleDoctorLock = (u: ApiAuthUser) => {
    setLockTarget({
      id: u.id,
      name: u.fullName,
      locked: !Boolean(u.isLocked),
    });
    setLockConfirmOpen(true);
  };

  const closeLockConfirm = () => {
    if (lockSubmitting) return;
    setLockConfirmOpen(false);
    setLockTarget(null);
  };

  const submitDoctorLock = async () => {
    if (!lockTarget) return;
    setLockSubmitting(true);
    try {
      const res = await api.setUserLocked(lockTarget.id, lockTarget.locked);
      toast.success(res.message);
      setLockConfirmOpen(false);
      setLockTarget(null);
      loadUsers();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Không cập nhật được trạng thái khóa",
      );
    } finally {
      setLockSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">
        Dashboard quản trị
      </h1>
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto pb-px scrollbar-none">
        {(
          [
            { id: "departments", icon: Building2, label: "Quản lý khoa" },
            { id: "users", icon: Users, label: "Người dùng" },
            { id: "payments", icon: CreditCard, label: "Thanh toán" },
            { id: "stats", icon: BarChart3, label: "Báo cáo" },
            { id: "ads", icon: Megaphone, label: "Quảng cáo" },
            { id: "ai", icon: Sparkles, label: "Chi phí AI" },
            { id: "leave", icon: Palmtree, label: "Nghỉ phép BS" },
            { id: "config", icon: Settings, label: "Cấu hình" },
          ] as { id: Tab; icon: React.ElementType; label: string }[]
        ).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap rounded-t-lg border-b-2 transition-colors shrink-0 ${
              tab === id
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100"
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {tab === "departments" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <h2 className="text-lg font-bold text-slate-900">
              Danh sách khoa
              <span className="ml-2 text-sm font-medium text-slate-500">
                ({filteredDepartments.length}
                {deptSearch.trim() ? ` / ${departments.length}` : ""})
              </span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={deptSearch}
                  onChange={(e) => setDeptSearch(e.target.value)}
                  placeholder="Tìm tên hoặc mô tả khoa..."
                  className="pl-9 pr-3 py-2 w-full sm:w-56 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                type="button"
                onClick={openAddDept}
                className="px-4 py-2 bg-primary text-white rounded-xl font-medium flex items-center gap-2 hover:bg-primary/90 shrink-0"
              >
                <Plus className="w-4 h-4" />
                Thêm khoa
              </button>
            </div>
          </div>
          {departments.length === 0 ? (
            <p className="p-8 text-center text-slate-500 text-sm">
              Chưa có khoa nào. Bấm «Thêm khoa» để tạo.
            </p>
          ) : filteredDepartments.length === 0 ? (
            <p className="p-8 text-center text-slate-500 text-sm">
              Không tìm thấy khoa phù hợp.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {deptPagination.paginatedItems.map((d) => (
                <li
                  key={d.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">
                      {d.name}
                    </p>
                    {d.description ? (
                      <p
                        className="text-xs text-slate-500 truncate mt-0.5"
                        title={d.description}
                      >
                        {d.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditDept(d)}
                      className="p-2 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg"
                      title="Sửa"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteDept(d.id)}
                      className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      title="Xóa"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {filteredDepartments.length > 0 && (
            <div className="px-4 pb-4">
              <ListPagination
                page={deptPagination.page}
                totalPages={deptPagination.totalPages}
                totalItems={deptPagination.totalItems}
                pageSize={deptPagination.pageSize}
                onPageChange={deptPagination.goToPage}
                itemLabel="khoa"
              />
            </div>
          )}
        </div>
      )}

      {tab === "users" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-3">
            <h2 className="text-lg font-bold text-slate-900">
              Danh sách người dùng
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openAddDoctor}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-primary text-primary text-sm font-bold hover:bg-primary/5 shadow-sm"
              >
                <Stethoscope className="w-4 h-4" />
                Thêm bác sĩ
              </button>
              <button
                type="button"
                onClick={openCreateManagedUser}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Thêm tài khoản
              </button>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    "all",
                    "user",
                    "doctor",
                    "admin",
                    "receptionist",
                    "cashier",
                  ] as const
                ).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setUserRoleFilter(r)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                      userRoleFilter === r
                        ? "bg-primary text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {r === "all"
                      ? "Tất cả"
                      : r === "user"
                        ? "Bệnh nhân"
                        : r === "doctor"
                          ? "Bác sĩ"
                          : r === "receptionist"
                            ? "Lễ tân"
                            : r === "cashier"
                              ? "Thu ngân"
                              : "Admin"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {usersLoading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <p className="p-8 text-center text-slate-500 text-sm">
              Không có người dùng.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Họ tên
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Email
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      SĐT
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Vai trò
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Ngày tạo
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {usersPagination.paginatedItems.map((u) => (
                    <tr
                      key={u.id}
                      className={`hover:bg-slate-50/50 ${
                        u.role === "doctor" && u.isLocked
                          ? "bg-amber-50/60 ring-1 ring-inset ring-amber-200"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {u.role === "doctor"
                          ? formatDoctorName(u.fullName)
                          : u.fullName}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {u.email}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {u.phone ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold px-2 py-1 rounded-md bg-slate-100 text-slate-700">
                            {u.role === "doctor"
                              ? "Bác sĩ"
                              : u.role === "admin"
                                ? "Quản trị"
                                : u.role === "receptionist"
                                  ? "Lễ tân"
                                  : u.role === "cashier"
                                    ? "Thu ngân"
                                    : "Bệnh nhân"}
                          </span>
                          {u.role === "doctor" && u.isLocked ? (
                            <span className="text-[11px] font-extrabold px-2 py-1 rounded-md bg-amber-100 text-amber-900 border border-amber-200">
                              Đã khóa
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {u.createdAt
                          ? new Date(u.createdAt).toLocaleDateString("vi-VN")
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          {u.role === "doctor" ? (
                            <button
                              type="button"
                              onClick={() =>
                                void openEditDoctor({
                                  id: u.id,
                                  departmentId: u.departmentId ?? null,
                                  fullName: u.fullName,
                                  bio: u.bio ?? null,
                                  experienceYears: u.experienceYears ?? null,
                                  avatarUrl: u.avatarUrl ?? null,
                                  createdAt:
                                    u.createdAt ?? new Date().toISOString(),
                                  university: u.university ?? null,
                                })
                              }
                              className="p-2 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg"
                              title="Sửa thông tin bác sĩ"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => openPwdAnyUser(u)}
                            className="p-2 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg"
                            title="Đổi mật khẩu"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                          {
                            <button
                              type="button"
                              onClick={() => void toggleDoctorLock(u)}
                              className={`p-2 rounded-lg ${
                                u.isLocked
                                  ? "text-amber-700 hover:bg-amber-50"
                                  : "text-slate-500 hover:text-amber-700 hover:bg-amber-50"
                              }`}
                              title={
                                u.isLocked
                                  ? "Đang khóa — bấm để mở khóa"
                                  : "Bấm để khóa đăng nhập"
                              }
                            >
                              <BellRing className="w-4 h-4" />
                            </button>
                          }
                          <button
                            type="button"
                            disabled={u.id === currentAdminId}
                            onClick={() => deleteManagedUserRow(u)}
                            className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-40 disabled:pointer-events-none"
                            title={
                              u.id === currentAdminId
                                ? "Không thể vô hiệu hóa chính mình"
                                : "Vô hiệu hóa"
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!usersLoading && users.length > 0 && (
            <div className="px-4 pb-4">
              <ListPagination
                page={usersPagination.page}
                totalPages={usersPagination.totalPages}
                totalItems={usersPagination.totalItems}
                pageSize={usersPagination.pageSize}
                onPageChange={usersPagination.goToPage}
                itemLabel="người dùng"
              />
            </div>
          )}
        </div>
      )}

      {tab === "payments" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Khoảng thời gian
              </span>
              <div
                className="flex p-0.5 rounded-lg bg-slate-200/80 border border-slate-200/60 gap-0.5"
                role="group"
                aria-label="Chọn nhanh khoảng ngày"
              >
                {ADMIN_STATS_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyAdminReportPreset(p.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                      adminReportPreset === p.id
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <span className="font-medium text-slate-600">Từ</span>
                <input
                  type="date"
                  value={adminReportFrom}
                  max={adminReportTo}
                  onChange={(e) =>
                    setAdminReportCustom({ from: e.target.value })
                  }
                  className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <span className="font-medium text-slate-600">Đến</span>
                <input
                  type="date"
                  value={adminReportTo}
                  min={adminReportFrom}
                  onChange={(e) => setAdminReportCustom({ to: e.target.value })}
                  className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Trạng thái TT
              </span>
              {(
                [
                  ["all", "Tất cả"],
                  ["pending", "Đang chờ"],
                  ["paid", "Đã thanh toán"],
                  ["failed", "Thất bại"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPaymentStatusFilter(id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                    paymentStatusFilter === id
                      ? "bg-primary text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">
                Giao dịch thanh toán
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Theo thời điểm tạo giao dịch (
                {formatShortDateVi(adminReportFrom)} –{" "}
                {formatShortDateVi(adminReportTo)})
              </p>
            </div>
            {adminPaymentsLoading ? (
              <div className="p-12 flex justify-center">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              </div>
            ) : adminPayments.length === 0 ? (
              <p className="p-8 text-center text-slate-500 text-sm">
                Không có giao dịch trong khoảng đã chọn.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left">
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">
                        Thời điểm
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase min-w-[10rem]">
                        Bệnh nhân
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                        Bác sĩ
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">
                        Lịch khám
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">
                        Số tiền
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                        Loại
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                        TT thanh toán
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                        TT lịch
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">
                        PayOS
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paymentsPagination.paginatedItems.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                          {formatPaymentDtVi(row.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">
                            {row.patient.fullName}
                          </div>
                          <div className="text-xs text-slate-500">
                            {row.patient.email}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-800">
                          {formatDoctorName(row.doctor.fullName)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {row.slotTime ? formatPaymentDtVi(row.slotTime) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {moneyFmtVnd.format(row.amount)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {paymentTypeLabelVi(row.paymentType)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-bold px-2 py-1 rounded-md ${
                              row.status === "paid"
                                ? "bg-emerald-100 text-emerald-900"
                                : row.status === "pending"
                                  ? "bg-amber-100 text-amber-900"
                                  : "bg-red-100 text-red-900"
                            }`}
                          >
                            {paymentStatusLabelVi(row.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">
                          {appointmentStatusLabelVi(row.appointmentStatus)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">
                          {row.payosOrderCode != null
                            ? row.payosOrderCode
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!adminPaymentsLoading && adminPayments.length > 0 && (
              <div className="px-4 pb-4">
                <ListPagination
                  page={paymentsPagination.page}
                  totalPages={paymentsPagination.totalPages}
                  totalItems={paymentsPagination.totalItems}
                  pageSize={paymentsPagination.pageSize}
                  onPageChange={paymentsPagination.goToPage}
                  itemLabel="giao dịch"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "stats" && (
        <div className="space-y-4">
          {/* Công cụ vận hành: chạy thủ công job nhắc lịch (cron đã chạy mỗi 5 phút). */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <BellRing className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-amber-900">
                    Nhắc lịch khám tự động
                  </div>
                  <p className="text-xs text-amber-800/90 mt-0.5">
                    Hệ thống tự gửi email H-24 và H-1 cho cuộc hẹn đã thanh toán
                    cọc (5 phút/lần). Bấm để chạy ngay không cần chờ.
                  </p>
                  {reminderResult ? (
                    <p className="text-xs text-amber-800/80 mt-1">
                      Lần chạy gần nhất:{" "}
                      <strong>
                        {reminderResult.h24Sent + reminderResult.h1Sent}
                      </strong>{" "}
                      email gửi (H-24: {reminderResult.h24Sent}, H-1:{" "}
                      {reminderResult.h1Sent})
                      {reminderResult.h24Failed + reminderResult.h1Failed > 0
                        ? `, lỗi: ${reminderResult.h24Failed + reminderResult.h1Failed}`
                        : ""}
                      {reminderResult.skipped > 0
                        ? `, bỏ qua: ${reminderResult.skipped}`
                        : ""}
                      .
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={handleRunReminders}
                disabled={reminderRunning}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2 shrink-0"
              >
                {reminderRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang gửi...
                  </>
                ) : (
                  <>
                    <BellRing className="w-4 h-4" />
                    Chạy nhắc lịch ngay
                  </>
                )}
              </button>
            </div>
            {/* Test riêng 1 cuộc hẹn — bỏ qua cửa sổ thời gian. Dùng khi cuộc hẹn còn cách
                xa hơn 24h hoặc admin muốn xem mail thật ngay. */}
            <div className="border-t border-amber-200/70 pt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
              <span className="text-xs font-semibold text-amber-900 uppercase tracking-wide shrink-0">
                Test 1 cuộc hẹn
              </span>
              <input
                type="text"
                value={testApptId}
                onChange={(e) => setTestApptId(e.target.value)}
                placeholder="Appointment ID (UUID)"
                className="flex-1 min-w-[260px] px-3 py-1.5 border border-amber-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-amber-500 focus:border-amber-500 font-mono"
              />
              <div className="flex p-0.5 rounded-lg bg-amber-100 border border-amber-200/60 gap-0.5 shrink-0">
                {(["h1", "h24"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTestKind(k)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                      testKind === k
                        ? "bg-white text-amber-900 shadow-sm"
                        : "text-amber-700 hover:text-amber-900"
                    }`}
                  >
                    {k === "h1" ? "H-1" : "H-24"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleSendTestReminder}
                disabled={testSending || !testApptId.trim()}
                className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
              >
                {testSending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Đang gửi...
                  </>
                ) : (
                  "Gửi mail test"
                )}
              </button>
            </div>
            <p className="text-[11px] text-amber-700/80">
              Mail test có prefix <code>[TEST]</code> trong tiêu đề. Bỏ qua cửa
              sổ thời gian và idempotency — bấm nhiều lần đều gửi.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <div
              className="flex p-0.5 rounded-lg bg-slate-200/80 border border-slate-200/60 gap-0.5 shrink-0"
              role="group"
              aria-label="Khoảng thời gian báo cáo"
            >
              {ADMIN_STATS_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyAdminReportPreset(p.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    adminReportPreset === p.id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <span
                className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                  adminReportPreset === "custom"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Tùy chọn
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-1.5">
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <span className="font-medium text-slate-600">Từ</span>
                <input
                  type="date"
                  value={adminReportFrom}
                  max={adminReportTo}
                  onChange={(e) =>
                    setAdminReportCustom({ from: e.target.value })
                  }
                  className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <span className="font-medium text-slate-600">Đến</span>
                <input
                  type="date"
                  value={adminReportTo}
                  min={adminReportFrom}
                  onChange={(e) => setAdminReportCustom({ to: e.target.value })}
                  className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </label>
            </div>
          </div>

          {adminStatsLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
          ) : !adminStats ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center text-sm text-slate-600">
              Không tải được báo cáo. Thử lại sau.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/90 px-3 py-2.5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800/80">
                    Doanh thu (đã thanh toán)
                  </div>
                  <div className="text-lg font-bold tabular-nums text-emerald-950 mt-0.5 leading-tight">
                    {moneyFmtVnd.format(adminStats.totalRevenuePaid)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Giao dịch
                  </div>
                  <div className="text-lg font-bold tabular-nums text-slate-900 mt-0.5">
                    {adminStats.paymentCounts.paid +
                      adminStats.paymentCounts.pending +
                      adminStats.paymentCounts.failed}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                    Đã TT {adminStats.paymentCounts.paid} · Chờ{" "}
                    {adminStats.paymentCounts.pending} · Lỗi{" "}
                    {adminStats.paymentCounts.failed}
                  </div>
                </div>
                <div className="rounded-xl border border-sky-200/80 bg-sky-50/90 px-3 py-2.5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-800/80">
                    BN có lịch (trong kỳ)
                  </div>
                  <div className="text-lg font-bold tabular-nums text-sky-950 mt-0.5">
                    {adminStats.distinctPatientsWithAppointmentInRange}
                  </div>
                  <div className="text-[10px] text-sky-900/70">
                    Distinct theo lịch hẹn tạo trong kỳ
                  </div>
                </div>
                <div className="rounded-xl border border-violet-200/80 bg-violet-50/90 px-3 py-2.5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-800/80">
                    Lịch hẹn (trong kỳ)
                  </div>
                  <div className="text-lg font-bold tabular-nums text-violet-950 mt-0.5">
                    {adminStats.appointmentsInRange}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    Tài khoản bệnh nhân
                  </div>
                  <div className="text-lg font-bold tabular-nums text-slate-900 mt-0.5">
                    {adminStats.patientAccountsTotal}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Toàn hệ thống
                  </div>
                </div>
                <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-900/80">
                    BN đăng ký mới
                  </div>
                  <div className="text-lg font-bold tabular-nums text-amber-950 mt-0.5">
                    {adminStats.newPatientRegistrationsInRange}
                  </div>
                  <div className="text-[10px] text-amber-900/70">
                    Trong kỳ đã chọn
                  </div>
                </div>
              </div>

              <section className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50/90 to-white p-4 sm:p-5 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3 mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Doanh thu theo ngày (đã thanh toán)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Đúng theo bộ lọc ngày phía trên ·{" "}
                      <span className="font-medium text-slate-700 tabular-nums">
                        {formatDayMonthVi(adminStats.range.from)} →{" "}
                        {formatDayMonthVi(adminStats.range.to)}
                      </span>
                      <span className="text-slate-400">
                        {" "}
                        ({adminStats.revenueByDay.length} ngày)
                      </span>
                      {maxRevenueDay > 0 ? (
                        <>
                          {" "}
                          · ngày cao nhất:{" "}
                          <span className="font-semibold tabular-nums text-emerald-800">
                            {moneyFmtVnd.format(maxRevenueDay)}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <span className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700">
                    <BarChart3 className="w-4 h-4" />
                  </span>
                </div>
                {adminStats.revenueByDay.every((d) => d.total === 0) ? (
                  <p className="text-sm text-slate-500 text-center py-10 border border-dashed border-slate-200 rounded-xl bg-white/80">
                    Chưa có doanh thu đã thanh toán trong kỳ đã chọn.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="relative rounded-xl border border-slate-100 bg-white px-2 pt-3 pb-1 shadow-inner">
                      <div
                        className="grid h-[220px] w-full items-end gap-x-1 gap-y-0"
                        style={{
                          gridTemplateColumns: `repeat(${adminStats.revenueByDay.length}, minmax(0, 1fr))`,
                        }}
                        role="img"
                        aria-label={`Biểu đồ doanh thu ${adminStats.revenueByDay.length} ngày`}
                      >
                        {adminStats.revenueByDay.map((d) => {
                          const denom = maxRevenueDay > 0 ? maxRevenueDay : 1;
                          const pct = Math.min(100, (d.total / denom) * 100);
                          const hasRev = d.total > 0;
                          return (
                            <div
                              key={d.date}
                              className="group relative flex h-full min-h-0 min-w-0 flex-col justify-end"
                              title={`${formatDayMonthVi(d.date)} · ${moneyFmtVnd.format(d.total)}`}
                            >
                              <div
                                className={`w-full rounded-t-[4px] transition-[height,opacity] ${
                                  hasRev
                                    ? "bg-gradient-to-t from-emerald-800 via-emerald-500 to-emerald-400 shadow-[0_-1px_8px_rgba(16,185,129,0.25)]"
                                    : "bg-slate-200/70"
                                }`}
                                style={{
                                  height: hasRev ? `${pct}%` : "3px",
                                  minHeight: hasRev ? "8px" : "3px",
                                  opacity: hasRev ? 1 : 0.45,
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 flex justify-between text-[10px] tabular-nums text-slate-400 px-0.5">
                        <span>{formatDayMonthVi(adminStats.range.from)}</span>
                        <span className="hidden sm:inline">
                          Theo giờ Việt Nam · cột = một ngày
                        </span>
                        <span>{formatDayMonthVi(adminStats.range.to)}</span>
                      </div>
                    </div>
                    <div
                      className="grid w-full gap-x-1"
                      style={{
                        gridTemplateColumns: `repeat(${adminStats.revenueByDay.length}, minmax(0, 1fr))`,
                      }}
                    >
                      {adminStats.revenueByDay.map((d, i, arr) => (
                        <div
                          key={`lbl-${d.date}`}
                          className="min-w-0 text-center"
                        >
                          {showAdminChartTick(
                            i,
                            arr.length,
                            adminChartLabelStride,
                          ) ? (
                            <span className="inline-block max-w-full truncate text-[9px] leading-tight text-slate-500 tabular-nums sm:text-[10px]">
                              {formatDayMonthVi(d.date)}
                            </span>
                          ) : (
                            <span className="inline-block h-3 w-px opacity-0">
                              .
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {tab === "ads" && <AdsManager />}

      {tab === "ai" && (
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <div
              className="flex p-0.5 rounded-lg bg-slate-200/80 border border-slate-200/60 gap-0.5 shrink-0"
              role="group"
              aria-label="Khoảng thời gian"
            >
              {ADMIN_STATS_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyAiReportPreset(p.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    aiReportPreset === p.id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <span
                className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                  aiReportPreset === "custom"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Tùy chọn
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-1.5">
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <span className="font-medium text-slate-600">Từ</span>
                <input
                  type="date"
                  value={aiReportFrom}
                  max={aiReportTo}
                  onChange={(e) => setAiReportCustom({ from: e.target.value })}
                  className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <span className="font-medium text-slate-600">Đến</span>
                <input
                  type="date"
                  value={aiReportTo}
                  min={aiReportFrom}
                  onChange={(e) => setAiReportCustom({ to: e.target.value })}
                  className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </label>
            </div>
          </div>

          {aiUsageLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
          ) : !aiUsage ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center text-sm text-slate-600">
              Không tải được báo cáo. Thử lại sau.
            </div>
          ) : (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl border border-violet-200/80 bg-violet-50/90 px-3 py-2.5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-800/80">
                    Tổng chi phí (USD)
                  </div>
                  <div className="text-lg font-bold tabular-nums text-violet-950 mt-0.5 leading-tight">
                    ${aiUsage.totals.costUsd.toFixed(4)}
                  </div>
                  <div className="text-[10px] text-violet-700 mt-0.5">
                    ≈{" "}
                    {Math.round(aiUsage.totals.costUsd * 25500).toLocaleString(
                      "vi-VN",
                    )}{" "}
                    đ
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Số request
                  </div>
                  <div className="text-lg font-bold tabular-nums text-slate-900 mt-0.5 leading-tight">
                    {aiUsage.totals.requests.toLocaleString("vi-VN")}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Token input
                  </div>
                  <div className="text-lg font-bold tabular-nums text-slate-900 mt-0.5 leading-tight">
                    {aiUsage.totals.promptTokens.toLocaleString("vi-VN")}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Token output
                  </div>
                  <div className="text-lg font-bold tabular-nums text-slate-900 mt-0.5 leading-tight">
                    {aiUsage.totals.completionTokens.toLocaleString("vi-VN")}
                  </div>
                </div>
              </div>

              {/* By feature + by model */}
              <div className="grid lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900">
                      Theo tính năng
                    </h3>
                  </div>
                  {aiUsage.byFeature.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-slate-500">
                      Chưa có dữ liệu trong khoảng này.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left">
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase">
                            Feature
                          </th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase text-right">
                            Calls
                          </th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase text-right">
                            Tokens
                          </th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase text-right">
                            USD
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiUsage.byFeature.map((r) => (
                          <tr
                            key={r.feature}
                            className="border-t border-slate-100"
                          >
                            <td className="px-4 py-2 font-mono text-xs text-slate-700">
                              {r.feature}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {r.requests}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                              {r.totalTokens.toLocaleString("vi-VN")}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums font-semibold">
                              ${r.costUsd.toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900">
                      Theo model
                    </h3>
                  </div>
                  {aiUsage.byModel.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-slate-500">
                      Chưa có dữ liệu trong khoảng này.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left">
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase">
                            Model
                          </th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase text-right">
                            Calls
                          </th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase text-right">
                            Tokens
                          </th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase text-right">
                            USD
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiUsage.byModel.map((r) => (
                          <tr
                            key={r.model}
                            className="border-t border-slate-100"
                          >
                            <td className="px-4 py-2 font-mono text-xs text-slate-700">
                              {r.model}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {r.requests}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                              {r.totalTokens.toLocaleString("vi-VN")}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums font-semibold">
                              ${r.costUsd.toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* By day — bar chart đơn giản */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
                <h3 className="text-sm font-bold text-slate-900 mb-3">
                  Chi phí theo ngày (USD)
                </h3>
                {aiUsage.byDay.length === 0 ? (
                  <div className="text-center text-sm text-slate-500 py-6">
                    Chưa có dữ liệu.
                  </div>
                ) : (
                  <AiUsageDailyChart data={aiUsage.byDay} />
                )}
              </div>

              <p className="text-[11px] text-slate-500">
                Tỉ giá quy đổi VND tham chiếu (~25.500 đ/USD), không phải tỉ giá
                hối đoái thực. Xem chi tiết phí trên dashboard OpenAI.
              </p>
            </>
          )}
        </div>
      )}

      {tab === "leave" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-3">
            <h2 className="text-lg font-bold text-slate-900">
              Đơn xin nghỉ phép
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLeaveStatusFilter("pending")}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                  leaveStatusFilter === "pending"
                    ? "bg-primary text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                Chờ duyệt
              </button>
              <button
                type="button"
                onClick={() => setLeaveStatusFilter("all")}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                  leaveStatusFilter === "all"
                    ? "bg-primary text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                Tất cả
              </button>
            </div>
          </div>
          {leaveLoading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
          ) : leaveList.length === 0 ? (
            <p className="p-8 text-center text-slate-500 text-sm">
              Không có đơn nào.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Bác sĩ
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase min-w-[12rem]">
                      Ngày làm việc (T2–T6)
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Lý do
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Trạng thái
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-40">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leavePagination.paginatedItems.map((r) => {
                    const workdays =
                      r.workdaysInRange?.length > 0
                        ? r.workdaysInRange
                        : listWeekdayIsoDatesInRange(r.startDate, r.endDate);
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">
                            {formatDoctorName(r.doctorName)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {r.doctorEmail}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 max-w-[20rem]">
                          <div>{formatWorkdaysShortVi(workdays)}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            Đơn ghi: {r.startDate} → {r.endDate}
                          </div>
                        </td>
                        <td
                          className="px-4 py-3 text-sm text-slate-600 max-w-[12rem] truncate"
                          title={r.reason ?? undefined}
                        >
                          {r.reason ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-bold px-2 py-1 rounded-md ${
                              r.status === "pending"
                                ? "bg-amber-100 text-amber-900"
                                : r.status === "approved"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-slate-200 text-slate-700"
                            }`}
                          >
                            {r.status === "pending"
                              ? "Chờ duyệt"
                              : r.status === "approved"
                                ? "Đã duyệt"
                                : "Từ chối"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {r.status === "pending" ? (
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() => approveLeave(r.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
                              >
                                <Check className="w-3.5 h-3.5" /> Duyệt
                              </button>
                              <button
                                type="button"
                                onClick={() => rejectLeave(r.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50"
                              >
                                <X className="w-3.5 h-3.5" /> Từ chối
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!leaveLoading && leaveList.length > 0 && (
            <div className="px-4 pb-4">
              <ListPagination
                page={leavePagination.page}
                totalPages={leavePagination.totalPages}
                totalItems={leavePagination.totalItems}
                pageSize={leavePagination.pageSize}
                onPageChange={leavePagination.goToPage}
                itemLabel="đơn nghỉ"
              />
            </div>
          )}
        </div>
      )}

      {tab === "config" && (
        <div className="space-y-4 max-w-2xl">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Tiền cọc đặt lịch
                </h3>
                <p className="text-xs text-slate-500">
                  Áp dụng cho mọi lịch hẹn mới tạo
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xs text-slate-400">Hiện tại</p>
                <p className="text-lg font-black text-primary tabular-nums">
                  {depositAmount.toLocaleString("vi-VN")}đ
                </p>
              </div>
            </div>
            <div className="px-6 py-5">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Số tiền cọc mới{" "}
                <span className="text-slate-400 font-normal">
                  (VND, tối thiểu 1.000)
                </span>
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min={1000}
                    max={10_000_000}
                    step={1000}
                    value={depositInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      // Chặn số âm ngay tại input
                      if (raw !== "" && Number(raw) < 0) return;
                      setDepositInput(raw);
                    }}
                    onKeyDown={(e) => {
                      // Chặn gõ dấu trừ
                      if (e.key === "-") e.preventDefault();
                    }}
                    className="w-full pl-3 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="50000"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
                    đ
                  </span>
                </div>
                <button
                  type="button"
                  disabled={depositSaving}
                  onClick={async () => {
                    const val = Number(depositInput);
                    if (!Number.isFinite(val) || val < 1_000) {
                      toast.error(
                        "Tiền cọc phải là số nguyên dương tối thiểu 1.000 VND",
                      );
                      return;
                    }
                    setDepositSaving(true);
                    try {
                      const res = await api.setDepositAmount(val);
                      setDepositAmountState(res.depositAmount);
                      setDepositInput(String(res.depositAmount));
                      toast.success(res.message);
                    } catch (e) {
                      toast.error(
                        e instanceof Error ? e.message : "Không lưu được",
                      );
                    } finally {
                      setDepositSaving(false);
                    }
                  }}
                  className="px-5 py-2.5 bg-primary text-white rounded-xl font-semibold text-sm disabled:opacity-50 flex items-center gap-2 shrink-0 hover:bg-primary/90 transition-colors"
                >
                  {depositSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Lưu
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Thay đổi có hiệu lực ngay cho lần đặt lịch tiếp theo. Các lịch
                hẹn đã tạo không bị ảnh hưởng.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal form khoa */}
      {deptFormOpen && (
        <ModalOverlay open onClose={closeDeptForm}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 relative pr-12">
            <ModalCloseButton
              onClose={closeDeptForm}
              disabled={deptSubmitting}
            />
            <h3 className="text-lg font-bold text-slate-900 mb-4 pr-2">
              {editingDeptId ? "Sửa khoa" : "Thêm khoa"}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Tên khoa
                </label>
                <input
                  type="text"
                  value={deptName}
                  onChange={(e) => {
                    setDeptName(e.target.value);
                    if (deptFieldError) setDeptFieldError(null);
                  }}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-primary focus:border-primary ${
                    deptFieldError
                      ? "border-red-300 bg-red-50/40"
                      : "border-slate-200"
                  }`}
                  placeholder="VD: Khoa Nội tổng quát"
                  aria-invalid={!!deptFieldError}
                />
                {deptFieldError ? (
                  <p className="text-xs text-red-600 mt-1">{deptFieldError}</p>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Mô tả
                </label>
                <textarea
                  value={deptDesc}
                  onChange={(e) => setDeptDesc(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  rows={2}
                  placeholder="Mô tả ngắn (tùy chọn)"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={closeDeptForm}
                className="flex-1 py-2 border border-slate-200 rounded-xl font-medium text-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={submitDept}
                disabled={deptSubmitting}
                className="flex-1 py-2 bg-primary text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deptSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                {editingDeptId ? "Cập nhật" : "Thêm"}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Modal form thêm bác sĩ */}
      {doctorFormOpen && (
        <ModalOverlay open onClose={() => setDoctorFormOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 sm:p-8 my-8 relative pr-12 sm:pr-14">
            <ModalCloseButton
              onClose={() => setDoctorFormOpen(false)}
              disabled={doctorSubmitting}
            />
            <h3 className="text-xl font-bold text-slate-900 mb-6 pr-2">
              Thêm bác sĩ
            </h3>
            {doctorError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                {doctorError}
              </div>
            )}
            <div className="flex flex-col md:flex-row gap-8 md:gap-10 md:items-start">
              <div className="flex justify-center md:justify-start shrink-0 md:pt-1">
                <AvatarPicker
                  file={doctorAvatarFile}
                  onChange={setDoctorAvatarFile}
                  label="Ảnh đại diện (tùy chọn)"
                  size="lg"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Họ tên *
                    </label>
                    <input
                      type="text"
                      value={doctorForm.fullName}
                      onChange={(e) =>
                        setDoctorForm((f) => ({
                          ...f,
                          fullName: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                      placeholder="Nguyễn Văn A"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      value={doctorForm.email}
                      onChange={(e) =>
                        setDoctorForm((f) => ({ ...f, email: e.target.value }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                      placeholder="bs.a@hospital.vn"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Mật khẩu *
                    </label>
                    <input
                      type="password"
                      value={doctorForm.password}
                      onChange={(e) =>
                        setDoctorForm((f) => ({
                          ...f,
                          password: e.target.value,
                        }))
                      }
                      className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-primary ${
                        doctorFieldErrors?.password
                          ? "border-red-300 bg-red-50/40"
                          : "border-slate-200"
                      }`}
                      placeholder="••••••••"
                    />
                    {doctorFieldErrors?.password ? (
                      <p className="text-xs text-red-600 mt-1">
                        {doctorFieldErrors.password}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Số điện thoại
                    </label>
                    <input
                      type="text"
                      value={doctorForm.phone ?? ""}
                      onChange={(e) =>
                        setDoctorForm((f) => ({
                          ...f,
                          phone: e.target.value || undefined,
                        }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                      placeholder="0901234567"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Khoa
                    </label>
                    <select
                      value={doctorForm.departmentId ?? ""}
                      onChange={(e) =>
                        setDoctorForm((f) => ({
                          ...f,
                          departmentId: e.target.value || null,
                        }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                    >
                      <option value="">— Chọn khoa —</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Trường đại học (tùy chọn)
                    </label>
                    <input
                      type="text"
                      value={doctorForm.university ?? ""}
                      onChange={(e) =>
                        setDoctorForm((f) => ({
                          ...f,
                          university: e.target.value || null,
                        }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                      placeholder="VD: Đại học Y Hà Nội"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Giới thiệu (bio)
                    </label>
                    <textarea
                      value={doctorForm.bio ?? ""}
                      onChange={(e) =>
                        setDoctorForm((f) => ({
                          ...f,
                          bio: e.target.value || null,
                        }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                      rows={2}
                      placeholder="Mô tả ngắn về chuyên môn"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Số năm kinh nghiệm
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={doctorForm.experienceYears ?? ""}
                      onChange={(e) => {
                        if (e.target.value === "") {
                          setDoctorForm((f) => ({
                            ...f,
                            experienceYears: null,
                          }));
                          return;
                        }
                        const n = parseInt(e.target.value, 10);
                        if (Number.isNaN(n)) return;
                        setDoctorForm((f) => ({
                          ...f,
                          experienceYears: Math.max(0, n),
                        }));
                      }}
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                      placeholder="10"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-8">
              <button
                onClick={() => setDoctorFormOpen(false)}
                className="flex-1 py-2 border border-slate-200 rounded-xl font-medium text-slate-700"
              >
                Hủy
              </button>
              <button
                onClick={submitDoctor}
                disabled={doctorSubmitting}
                className="flex-1 py-2 bg-primary text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {doctorSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Thêm bác sĩ
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {editDoctorOpen && (
        <ModalOverlay open onClose={() => setEditDoctorOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 sm:p-8 my-8 relative pr-12 sm:pr-14">
            <ModalCloseButton
              onClose={() => setEditDoctorOpen(false)}
              disabled={editDoctorSubmitting || editDoctorLoading}
            />
            {editDoctorLoading ? (
              <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-2xl z-10">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              </div>
            ) : null}
            <h3 className="text-xl font-bold text-slate-900 mb-6 pr-2">
              Cập nhật bác sĩ
            </h3>
            {editDoctorError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                {editDoctorError}
              </div>
            )}
            <div className="flex flex-col md:flex-row gap-8 md:gap-10 md:items-start">
              <div className="flex justify-center md:justify-start shrink-0 md:pt-1">
                <AvatarPicker
                  file={editDoctorAvatar}
                  onChange={setEditDoctorAvatar}
                  label="Đổi ảnh (tùy chọn)"
                  size="lg"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Họ tên *
                    </label>
                    <input
                      type="text"
                      value={editDoctorForm.fullName}
                      onChange={(e) =>
                        setEditDoctorForm((f) => ({
                          ...f,
                          fullName: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      value={editDoctorForm.email}
                      onChange={(e) =>
                        setEditDoctorForm((f) => ({
                          ...f,
                          email: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Số điện thoại
                    </label>
                    <input
                      type="text"
                      value={editDoctorForm.phone ?? ""}
                      onChange={(e) =>
                        setEditDoctorForm((f) => ({
                          ...f,
                          phone: e.target.value || null,
                        }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                      placeholder="0901234567"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Khoa
                    </label>
                    <select
                      value={editDoctorForm.departmentId ?? ""}
                      onChange={(e) =>
                        setEditDoctorForm((f) => ({
                          ...f,
                          departmentId: e.target.value || null,
                        }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                    >
                      <option value="">— Chọn khoa —</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Trường đại học
                    </label>
                    <input
                      type="text"
                      value={editDoctorForm.university ?? ""}
                      onChange={(e) =>
                        setEditDoctorForm((f) => ({
                          ...f,
                          university: e.target.value || null,
                        }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Số năm kinh nghiệm
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={editDoctorForm.experienceYears ?? ""}
                      onChange={(e) => {
                        if (e.target.value === "") {
                          setEditDoctorForm((f) => ({
                            ...f,
                            experienceYears: null,
                          }));
                          return;
                        }
                        const n = parseInt(e.target.value, 10);
                        if (Number.isNaN(n)) return;
                        setEditDoctorForm((f) => ({
                          ...f,
                          experienceYears: Math.max(0, n),
                        }));
                      }}
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Giới thiệu (bio)
                    </label>
                    <textarea
                      value={editDoctorForm.bio ?? ""}
                      onChange={(e) =>
                        setEditDoctorForm((f) => ({
                          ...f,
                          bio: e.target.value || null,
                        }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary"
                      rows={2}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-8">
              <button
                type="button"
                onClick={() => setEditDoctorOpen(false)}
                className="flex-1 py-2 border border-slate-200 rounded-xl font-medium text-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={submitEditDoctor}
                disabled={editDoctorSubmitting || editDoctorLoading}
                className="flex-1 py-2 bg-primary text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {editDoctorSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Lưu thay đổi
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {createUserOpen && (
        <ModalOverlay
          open
          onClose={() => !createUserSubmitting && setCreateUserOpen(false)}
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 relative pr-12">
            <ModalCloseButton
              onClose={() => setCreateUserOpen(false)}
              disabled={createUserSubmitting}
            />
            <h3 className="text-lg font-bold text-slate-900 mb-1 pr-2">
              Thêm tài khoản
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Tạo tài khoản bệnh nhân mới. Để thêm bác sĩ (có sinh lịch khám),
              dùng nút « Thêm bác sĩ » bên cạnh.
            </p>
            <label className="block mb-3 text-sm">
              Vai trò
              <select
                className="block w-full border rounded-lg p-2"
                value={createUserRole}
                onChange={(e) =>
                  setCreateUserRole(e.target.value as typeof createUserRole)
                }
              >
                <option value="user">Bệnh nhân</option>
                <option value="receptionist">Lễ tân</option>
                <option value="cashier">Thu ngân</option>
                <option value="admin">Quản trị</option>
              </select>
            </label>
            {createUserError && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                {createUserError}
              </div>
            )}
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                Email
                <input
                  type="email"
                  value={createUserForm.email}
                  onChange={(e) =>
                    setCreateUserForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl"
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Mật khẩu ban đầu
                <input
                  type="password"
                  value={createUserForm.password}
                  onChange={(e) =>
                    setCreateUserForm((f) => ({
                      ...f,
                      password: e.target.value,
                    }))
                  }
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl"
                  autoComplete="new-password"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Họ tên
                <input
                  type="text"
                  value={createUserForm.fullName}
                  onChange={(e) =>
                    setCreateUserForm((f) => ({
                      ...f,
                      fullName: e.target.value,
                    }))
                  }
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                SĐT (tuỳ chọn)
                <input
                  type="tel"
                  value={createUserForm.phone}
                  onChange={(e) =>
                    setCreateUserForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </label>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={() => setCreateUserOpen(false)}
                disabled={createUserSubmitting}
                className="flex-1 py-2 border border-slate-200 rounded-xl font-medium text-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={submitCreateManagedUser}
                disabled={createUserSubmitting}
                className="flex-1 py-2 bg-primary text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {createUserSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Tạo tài khoản
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {pwdModalOpen && (
        <ModalOverlay open onClose={() => setPwdModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 relative pr-12">
            <ModalCloseButton
              onClose={() => setPwdModalOpen(false)}
              disabled={pwdSubmitting}
            />
            <h3 className="text-lg font-bold text-slate-900 mb-1 pr-2">
              Đổi mật khẩu
            </h3>
            <p className="text-sm text-slate-600 mb-4">{pwdDoctorName}</p>
            {pwdError && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                {pwdError}
              </div>
            )}
            <p className="text-xs text-slate-500 mb-4">
              Tối thiểu 8 ký tự, gồm chữ hoa, thường, số và ký tự đặc biệt.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Mật khẩu mới
                </label>
                <input
                  type="password"
                  value={pwdNew}
                  onChange={(e) => {
                    setPwdNew(e.target.value);
                    setPwdFieldErrors(null);
                  }}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-primary ${pwdFieldErrors?.password ? "border-red-300" : "border-slate-200"}`}
                />
                {pwdFieldErrors?.password ? (
                  <p className="text-xs text-red-600 mt-1">
                    {pwdFieldErrors.password}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nhập lại mật khẩu
                </label>
                <input
                  type="password"
                  value={pwdConfirm}
                  onChange={(e) => {
                    setPwdConfirm(e.target.value);
                    setPwdFieldErrors(null);
                  }}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-primary ${pwdFieldErrors?.confirmPassword ? "border-red-300" : "border-slate-200"}`}
                />
                {pwdFieldErrors?.confirmPassword ? (
                  <p className="text-xs text-red-600 mt-1">
                    {pwdFieldErrors.confirmPassword}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={() => setPwdModalOpen(false)}
                className="flex-1 py-2 border border-slate-200 rounded-xl font-medium text-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={submitPwdDoctor}
                disabled={pwdSubmitting}
                className="flex-1 py-2 bg-primary text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {pwdSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Cập nhật mật khẩu
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {lockConfirmOpen && lockTarget && (
        <ModalOverlay open onClose={closeLockConfirm}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 relative pr-12">
            <ModalCloseButton
              onClose={closeLockConfirm}
              disabled={lockSubmitting}
            />
            <h3 className="text-lg font-bold text-slate-900 mb-2 pr-2">
              {lockTarget.locked
                ? "Khóa tài khoản bác sĩ"
                : "Mở khóa tài khoản bác sĩ"}
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              {lockTarget.locked
                ? `Bác sĩ “${lockTarget.name}” sẽ không thể đăng nhập cho đến khi được mở khóa.`
                : `Bác sĩ “${lockTarget.name}” sẽ có thể đăng nhập lại.`}
            </p>
            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={closeLockConfirm}
                disabled={lockSubmitting}
                className="flex-1 py-2 border border-slate-200 rounded-xl font-medium text-slate-700 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void submitDoctorLock()}
                disabled={lockSubmitting}
                className={`flex-1 py-2 rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2 ${
                  lockTarget.locked
                    ? "bg-amber-600 text-white hover:bg-amber-700"
                    : "bg-primary text-white hover:bg-primary/90"
                }`}
              >
                {lockSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                {lockTarget.locked ? "Xác nhận khóa" : "Xác nhận mở khóa"}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};
