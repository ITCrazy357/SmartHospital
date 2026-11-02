import React, { useState, useEffect, useMemo } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronRight,
  ChevronLeft,
  Clock,
  FileText,
  LayoutList,
  Loader2,
  Palmtree,
  PieChart,
  UserRound,
  Users,
  Search,
  CalendarClock,
  CalendarRange,
  Phone,
  Mail,
  CheckCircle2,
  Stethoscope,
  Sparkles,
} from "lucide-react";
import { api } from "../api/client";
import type {
  ApiAppointmentSlot,
  ApiDoctorAppointment,
  ApiDoctorLeaveRequest,
  ApiDoctorMedicalRecordListItem,
  ApiDoctorPatient,
  ApiDoctorPendingMedicalAppointment,
  ApiDoctorStats,
} from "../api/client";
import { useToast } from "../contexts/ToastContext";
import {
  firstWeekdayOnOrAfter,
  formatWorkdaysShortVi,
  isWeekendIsoDate,
  listWeekdayIsoDatesInRange,
} from "../utils/weekdayCalendar";
import { ModalCloseButton, ModalOverlay } from "./ModalOverlay";
import { DoctorAiAssistantTab } from "./doctor/DoctorAiAssistantTab";
import { MedicalRecordHistory } from "./MedicalRecordHistory";
import { ListPagination } from "./ListPagination";
import { usePagination, PAGE_SIZE } from "../utils/usePagination";

function formatSlotDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatSlotTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function formatStatus(status: string): string {
  if (status === "booked") return "Đã đặt";
  if (status === "on_leave") return "Nghỉ phép";
  return "Trống";
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Trả về ngày thứ 2 (ISO YYYY-MM-DD) của tuần chứa ngày đã cho. */
function startOfIsoWeek(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function isoDateOf(d: Date): string {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return tz.toISOString().slice(0, 10);
}

function formatDayHeaderLong(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatWeekRange(startIso: string, endIso: string): string {
  const s = new Date(startIso + "T12:00:00");
  const e = new Date(endIso + "T12:00:00");
  const sStr = s.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
  });
  const eStr = e.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${sStr} – ${eStr}`;
}

function formatRelativeDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / 86_400_000);
  if (diffDays === 0) return `Hôm nay · ${formatSlotTime(iso)}`;
  if (diffDays === 1) return `Ngày mai · ${formatSlotTime(iso)}`;
  if (diffDays === -1) return `Hôm qua · ${formatSlotTime(iso)}`;
  return `${formatSlotDate(iso)} · ${formatSlotTime(iso)}`;
}

type StatusFilter = "all" | "available" | "booked" | "on_leave";

const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "available", label: "Còn trống" },
  { id: "booked", label: "Đã đặt" },
  { id: "on_leave", label: "Nghỉ phép" },
];

/** Từ hôm nay, đủ `spanDays` ngày (1 = chỉ hôm nay). */
function presetRange(spanDays: number): { from: string; to: string } {
  const from = todayIso();
  return { from, to: addDaysIso(from, spanDays - 1) };
}

const DAY_PRESETS = [1, 2, 3, 4, 5, 6, 7, 14] as const;

function leaveStatusLabel(s: ApiDoctorLeaveRequest["status"]): string {
  if (s === "pending") return "Chờ duyệt";
  if (s === "approved") return "Đã duyệt";
  return "Từ chối";
}

function patientInitials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function appointmentStatusBadge(status: string): {
  label: string;
  className: string;
} {
  const s = status.toLowerCase();
  if (s === "completed")
    return {
      label: "Hoàn tất",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  if (s === "confirmed")
    return {
      label: "Đã xác nhận",
      className: "bg-sky-50 text-sky-700 border-sky-200",
    };
  if (s === "pending")
    return {
      label: "Chờ thanh toán",
      className: "bg-amber-50 text-amber-800 border-amber-200",
    };
  if (s === "cancelled")
    return {
      label: "Đã huỷ",
      className: "bg-red-50 text-red-700 border-red-200",
    };
  return {
    label: status,
    className: "bg-slate-100 text-slate-700 border-slate-200",
  };
}

function StatMini({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "amber" | "neutral";
}) {
  const tones = {
    slate: "bg-white/90 text-slate-900 border-slate-200/90 shadow-sm",
    emerald: "bg-emerald-50/95 text-emerald-900 border-emerald-200/70",
    amber: "bg-amber-50/95 text-amber-950 border-amber-200/70",
    neutral: "bg-slate-100/90 text-slate-800 border-slate-200/80",
  };
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tones[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums leading-tight mt-0.5">
        {value}
      </div>
    </div>
  );
}

const inputBase =
  "w-full px-3 py-2 text-sm border border-slate-200/90 rounded-xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-shadow";

type DoctorTab =
  | "overview"
  | "slots"
  | "appointments"
  | "patients"
  | "stats"
  | "ai";
type CalendarView = "day" | "week";

type StatsRangePreset = "7d" | "30d" | "90d" | "custom";

function isoDateOnlyLocal(d: Date): string {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return tz.toISOString().slice(0, 10);
}

function statsPresetRange(preset: Exclude<StatsRangePreset, "custom">): {
  from: string;
  to: string;
} {
  const today = isoDateOnlyLocal(new Date());
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const fromD = new Date();
  fromD.setDate(fromD.getDate() - (days - 1));
  return { from: isoDateOnlyLocal(fromD), to: today };
}

export const DashboardDoctor: React.FC = () => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<DoctorTab>("overview");

  // ============ Slot state (Tab Lịch ca) ============
  const [slots, setSlots] = useState<ApiAppointmentSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(() => todayIso());
  const [toDate, setToDate] = useState(() => presetRange(7).to);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // ============ Leave state (Tab Tổng quan) ============
  const [leaveRequests, setLeaveRequests] = useState<ApiDoctorLeaveRequest[]>(
    [],
  );
  const [leaveLoading, setLeaveLoading] = useState(true);
  const [leaveStart, setLeaveStart] = useState(() =>
    firstWeekdayOnOrAfter(todayIso(), addDaysIso),
  );
  const [leaveEnd, setLeaveEnd] = useState(() => {
    const s = firstWeekdayOnOrAfter(todayIso(), addDaysIso);
    let e = addDaysIso(s, 2);
    while (isWeekendIsoDate(e)) e = addDaysIso(e, 1);
    return e;
  });
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);

  // ============ Pending medical / records (Tab Tổng quan) ============
  const [pendingMedical, setPendingMedical] = useState<
    ApiDoctorPendingMedicalAppointment[]
  >([]);
  const [pendingMedicalLoading, setPendingMedicalLoading] = useState(true);
  const [mrModalAppt, setMrModalAppt] =
    useState<ApiDoctorPendingMedicalAppointment | null>(null);
  const [mrSymptoms, setMrSymptoms] = useState("");
  const [mrDiagnosis, setMrDiagnosis] = useState("");
  const [mrTreatment, setMrTreatment] = useState("");
  const [mrNotes, setMrNotes] = useState("");
  const [mrSubmitting, setMrSubmitting] = useState(false);

  const [myRecords, setMyRecords] = useState<ApiDoctorMedicalRecordListItem[]>(
    [],
  );
  const [myRecordsLoading, setMyRecordsLoading] = useState(true);
  const [editRecord, setEditRecord] =
    useState<ApiDoctorMedicalRecordListItem | null>(null);
  const [erSymptoms, setErSymptoms] = useState("");
  const [erDiagnosis, setErDiagnosis] = useState("");
  const [erTreatment, setErTreatment] = useState("");
  const [erNotes, setErNotes] = useState("");
  const [erReason, setErReason] = useState("");
  const [erSubmitting, setErSubmitting] = useState(false);

  // ============ Patients tab ============
  const [patients, setPatients] = useState<ApiDoctorPatient[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [patientSearch, setPatientSearch] = useState("");

  // ============ Appointments calendar tab ============
  const [calendarView, setCalendarView] = useState<CalendarView>("day");
  const [anchorDate, setAnchorDate] = useState<string>(() => todayIso());
  const [appointments, setAppointments] = useState<ApiDoctorAppointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);

  // ============ Stats tab ============
  const [statsPreset, setStatsPreset] = useState<StatsRangePreset>("30d");
  const [statsFrom, setStatsFrom] = useState<string>(
    () => statsPresetRange("30d").from,
  );
  const [statsTo, setStatsTo] = useState<string>(
    () => statsPresetRange("30d").to,
  );
  const [recordStats, setRecordStats] = useState<ApiDoctorStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // ============ Loaders ============
  const loadSlots = () => {
    setLoading(true);
    api
      .getMySlots(fromDate)
      .then(setSlots)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Không tải được lịch");
        setSlots([]);
      })
      .finally(() => setLoading(false));
  };

  const loadLeaveRequests = () => {
    setLeaveLoading(true);
    api
      .getMyLeaveRequests()
      .then(setLeaveRequests)
      .catch(() => setLeaveRequests([]))
      .finally(() => setLeaveLoading(false));
  };

  const loadPendingMedical = () => {
    setPendingMedicalLoading(true);
    api
      .getDoctorPendingMedicalAppointments()
      .then(setPendingMedical)
      .catch(() => setPendingMedical([]))
      .finally(() => setPendingMedicalLoading(false));
  };

  const loadMyRecords = () => {
    setMyRecordsLoading(true);
    api
      .getMyMedicalRecords()
      .then(setMyRecords)
      .catch(() => setMyRecords([]))
      .finally(() => setMyRecordsLoading(false));
  };

  const loadPatients = () => {
    setPatientsLoading(true);
    api
      .getMyDoctorPatients()
      .then(setPatients)
      .catch(() => setPatients([]))
      .finally(() => setPatientsLoading(false));
  };

  // ============ Modal handlers ============
  const openMedicalRecordModal = (a: ApiDoctorPendingMedicalAppointment) => {
    setMrModalAppt(a);
    setMrSymptoms(a.appointmentSymptoms?.trim() ?? "");
    setMrDiagnosis("");
    setMrTreatment("");
    setMrNotes("");
  };

  const closeMedicalRecordModal = () => {
    setMrModalAppt(null);
    setMrSymptoms("");
    setMrDiagnosis("");
    setMrTreatment("");
    setMrNotes("");
  };

  const submitMedicalRecord = async () => {
    if (!mrModalAppt) return;
    const hasContent =
      mrSymptoms.trim() ||
      mrDiagnosis.trim() ||
      mrTreatment.trim() ||
      mrNotes.trim();
    if (!hasContent) {
      toast.error(
        "Nhập ít nhất một trong: triệu chứng, chẩn đoán, điều trị hoặc ghi chú.",
      );
      return;
    }
    setMrSubmitting(true);
    try {
      const res = await api.createDoctorMedicalRecord({
        appointmentId: mrModalAppt.id,
        symptoms: mrSymptoms.trim() || null,
        diagnosis: mrDiagnosis.trim() || null,
        treatment: mrTreatment.trim() || null,
        notes: mrNotes.trim() || null,
      });
      toast.success(
        res.embeddingStored
          ? "Đã lưu hồ sơ và vector cho RAG."
          : "Đã lưu hồ sơ. (Embedding: cần pgvector + OPENAI_API_KEY trên server.)",
      );
      closeMedicalRecordModal();
      loadPendingMedical();
      loadMyRecords();
      loadSlots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không lưu được hồ sơ");
    } finally {
      setMrSubmitting(false);
    }
  };

  const openEditRecordModal = (r: ApiDoctorMedicalRecordListItem) => {
    setEditRecord(r);
    setErSymptoms(r.symptoms?.trim() ?? "");
    setErDiagnosis(r.diagnosis?.trim() ?? "");
    setErTreatment(r.treatment?.trim() ?? "");
    setErNotes(r.notes?.trim() ?? "");
  };

  const closeEditRecordModal = () => {
    setEditRecord(null);
    setErSymptoms("");
    setErDiagnosis("");
    setErTreatment("");
    setErNotes("");
    setErReason("");
  };

  const submitEditRecord = async () => {
    if (!editRecord) return;
    if (!erReason.trim()) {
      toast.error("Nhập lý do chỉnh sửa để lưu lịch sử hồ sơ.");
      return;
    }
    const hasContent =
      erSymptoms.trim() ||
      erDiagnosis.trim() ||
      erTreatment.trim() ||
      erNotes.trim();
    if (!hasContent) {
      toast.error(
        "Nhập ít nhất một trong: triệu chứng, chẩn đoán, điều trị hoặc ghi chú.",
      );
      return;
    }
    setErSubmitting(true);
    try {
      const res = await api.updateDoctorMedicalRecord(editRecord.id, {
        version: editRecord.version,
        reason: erReason.trim(),
        symptoms: erSymptoms.trim() || null,
        diagnosis: erDiagnosis.trim() || null,
        treatment: erTreatment.trim() || null,
        notes: erNotes.trim() || null,
      });
      toast.success(
        res.embeddingStored
          ? "Đã cập nhật hồ sơ và embedding."
          : "Đã cập nhật hồ sơ.",
      );
      closeEditRecordModal();
      loadMyRecords();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không cập nhật được");
    } finally {
      setErSubmitting(false);
    }
  };

  // ============ Effects ============
  useEffect(() => {
    loadSlots();
  }, [fromDate]);

  useEffect(() => {
    loadLeaveRequests();
    loadPendingMedical();
    loadMyRecords();
    loadPatients();
  }, []);

  // Load appointments khi vào tab Lịch hẹn hoặc đổi view/date
  useEffect(() => {
    if (activeTab !== "appointments") return;
    let from: string;
    let to: string;
    if (calendarView === "day") {
      from = anchorDate;
      to = anchorDate;
    } else {
      from = startOfIsoWeek(anchorDate);
      to = addDaysIso(from, 6);
    }
    setAppointmentsLoading(true);
    api
      .getMyDoctorAppointments(from, to)
      .then(setAppointments)
      .catch(() => setAppointments([]))
      .finally(() => setAppointmentsLoading(false));
  }, [activeTab, calendarView, anchorDate]);

  useEffect(() => {
    if (activeTab !== "stats") return;
    setStatsLoading(true);
    api
      .getMyDoctorStats(statsFrom, statsTo)
      .then(setRecordStats)
      .catch(() => setRecordStats(null))
      .finally(() => setStatsLoading(false));
  }, [activeTab, statsFrom, statsTo]);

  const applyStatsPreset = (p: Exclude<StatsRangePreset, "custom">) => {
    const r = statsPresetRange(p);
    setStatsPreset(p);
    setStatsFrom(r.from);
    setStatsTo(r.to);
  };

  const setStatsCustom = (next: { from?: string; to?: string }) => {
    setStatsPreset("custom");
    if (next.from !== undefined) setStatsFrom(next.from);
    if (next.to !== undefined) setStatsTo(next.to);
  };

  // ============ Computed ============
  const filteredSlots = useMemo(() => {
    const list = slots.filter((s) => {
      const dStr = s.slotTime.slice(0, 10);
      if (dStr < fromDate) return false;
      if (toDate && dStr > toDate) return false;
      if (statusFilter === "available" && s.status !== "available")
        return false;
      if (statusFilter === "booked" && s.status !== "booked") return false;
      if (statusFilter === "on_leave" && s.status !== "on_leave") return false;
      return true;
    });
    return list.sort(
      (a, b) => new Date(a.slotTime).getTime() - new Date(b.slotTime).getTime(),
    );
  }, [slots, fromDate, toDate, statusFilter]);

  const stats = useMemo(() => {
    const free = filteredSlots.filter((s) => s.status === "available").length;
    const booked = filteredSlots.filter((s) => s.status === "booked").length;
    const onLeave = filteredSlots.filter((s) => s.status === "on_leave").length;
    return { free, booked, onLeave, total: filteredSlots.length };
  }, [filteredSlots]);

  const filteredPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) =>
      `${p.fullName} ${p.email} ${p.phone ?? ""}`.toLowerCase().includes(q),
    );
  }, [patients, patientSearch]);

  const setFromAndClampTo = (nextFrom: string) => {
    setFromDate(nextFrom);
    setToDate((prev) => (prev < nextFrom ? nextFrom : prev));
  };

  const applyPresetDays = (spanDays: number) => {
    const { from, to } = presetRange(spanDays);
    setFromDate(from);
    setToDate(to);
  };

  const rangeMatchesPreset = (spanDays: number): boolean => {
    const { from, to } = presetRange(spanDays);
    return fromDate === from && toDate === to;
  };

  const submitLeaveRequest = async () => {
    if (leaveStart > leaveEnd) {
      toast.error("Ngày bắt đầu không được sau ngày kết thúc.");
      return;
    }
    if (isWeekendIsoDate(leaveStart) || isWeekendIsoDate(leaveEnd)) {
      toast.error(
        "Chỉ chọn thứ 2 – thứ 6 cho ngày bắt đầu và kết thúc (không chọn thứ 7 hoặc chủ nhật).",
      );
      return;
    }
    const wd = listWeekdayIsoDatesInRange(leaveStart, leaveEnd);
    if (wd.length === 0) {
      toast.error("Khoảng đã chọn không có ngày làm việc nào.");
      return;
    }
    setLeaveSubmitting(true);
    try {
      await api.createLeaveRequest({
        startDate: leaveStart,
        endDate: leaveEnd,
        reason: leaveReason.trim() || null,
      });
      toast.success("Đã gửi đơn xin nghỉ. Quản trị sẽ xem xét.");
      setLeaveReason("");
      loadLeaveRequests();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không gửi được đơn");
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const pendingCount = pendingMedical.length;

  // ============ Render ============
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-100/80 via-white to-sky-50/40">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <header className="mb-6 lg:mb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Bảng điều khiển bác sĩ
              </h1>
              <p className="mt-1 text-sm text-slate-600 max-w-xl">
                Quản lý hồ sơ sau ca, lịch ca, lịch hẹn ngày/tuần và danh sách
                bệnh nhân của bạn — tất cả trong một chỗ.
              </p>
            </div>
            {!pendingMedicalLoading && pendingCount > 0 ? (
              <div className="flex items-center gap-2 rounded-2xl bg-amber-50 border border-amber-200/80 px-4 py-2 text-sm text-amber-950 shadow-sm">
                <span className="font-semibold tabular-nums text-lg">
                  {pendingCount}
                </span>
                <span className="text-amber-900/90">ca chờ nhập hồ sơ</span>
              </div>
            ) : null}
          </div>
        </header>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-sm shadow-sm">
            {error}
          </div>
        )}

        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/40 px-2 sm:px-4">
            <nav
              className="flex gap-1 overflow-x-auto -mb-px"
              role="tablist"
              aria-label="Khu vực dashboard"
            >
              <DocTabButton
                icon={LayoutList}
                label="Tổng quan"
                badge={pendingCount}
                active={activeTab === "overview"}
                onClick={() => setActiveTab("overview")}
              />
              <DocTabButton
                icon={CalendarDays}
                label="Lịch ca"
                active={activeTab === "slots"}
                onClick={() => setActiveTab("slots")}
              />
              <DocTabButton
                icon={CalendarClock}
                label="Lịch hẹn"
                active={activeTab === "appointments"}
                onClick={() => setActiveTab("appointments")}
              />
              <DocTabButton
                icon={Users}
                label="Bệnh nhân"
                badge={patients.length}
                active={activeTab === "patients"}
                onClick={() => setActiveTab("patients")}
              />
              <DocTabButton
                icon={BarChart3}
                label="Thống kê"
                active={activeTab === "stats"}
                onClick={() => setActiveTab("stats")}
              />
              <DocTabButton
                icon={Sparkles}
                label="Trợ lý AI"
                active={activeTab === "ai"}
                onClick={() => setActiveTab("ai")}
              />
            </nav>
          </div>

          <div className="p-4 sm:p-6">
            {activeTab === "overview" && (
              <OverviewTab
                pendingMedical={pendingMedical}
                pendingMedicalLoading={pendingMedicalLoading}
                myRecords={myRecords}
                myRecordsLoading={myRecordsLoading}
                onOpenMedicalRecord={openMedicalRecordModal}
                onOpenEditRecord={openEditRecordModal}
                leaveRequests={leaveRequests}
                leaveLoading={leaveLoading}
                leaveStart={leaveStart}
                leaveEnd={leaveEnd}
                leaveReason={leaveReason}
                leaveSubmitting={leaveSubmitting}
                onSetLeaveStart={setLeaveStart}
                onSetLeaveEnd={setLeaveEnd}
                onSetLeaveReason={setLeaveReason}
                onSubmitLeave={submitLeaveRequest}
              />
            )}

            {activeTab === "slots" && (
              <SlotsTab
                slots={slots}
                filteredSlots={filteredSlots}
                stats={stats}
                loading={loading}
                fromDate={fromDate}
                toDate={toDate}
                statusFilter={statusFilter}
                onSetFromAndClampTo={setFromAndClampTo}
                onSetToDate={setToDate}
                onSetStatusFilter={setStatusFilter}
                onApplyPreset={applyPresetDays}
                rangeMatchesPreset={rangeMatchesPreset}
              />
            )}

            {activeTab === "appointments" && (
              <AppointmentsTab
                appointments={appointments}
                loading={appointmentsLoading}
                view={calendarView}
                anchorDate={anchorDate}
                onChangeView={setCalendarView}
                onSetAnchorDate={setAnchorDate}
                onJumpToToday={() => setAnchorDate(todayIso())}
              />
            )}

            {activeTab === "patients" && (
              <PatientsTab
                patients={filteredPatients}
                totalCount={patients.length}
                loading={patientsLoading}
                search={patientSearch}
                onSearchChange={setPatientSearch}
              />
            )}

            {activeTab === "stats" && (
              <StatsTab
                stats={recordStats}
                loading={statsLoading}
                preset={statsPreset}
                from={statsFrom}
                to={statsTo}
                onApplyPreset={applyStatsPreset}
                onSetCustomRange={setStatsCustom}
              />
            )}

            {activeTab === "ai" && <DoctorAiAssistantTab />}
          </div>
        </div>
      </div>

      {/* ====== MODALS ====== */}
      {mrModalAppt && (
        <ModalOverlay open onClose={closeMedicalRecordModal}>
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-lg w-full p-6 sm:p-7 my-8 ring-1 ring-black/[0.04] relative pr-12 sm:pr-14"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mr-modal-title"
          >
            <ModalCloseButton
              onClose={closeMedicalRecordModal}
              disabled={mrSubmitting}
            />
            <div className="flex items-start gap-3 mb-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-sm">
                {patientInitials(mrModalAppt.patientName)}
              </span>
              <div className="min-w-0">
                <h3
                  id="mr-modal-title"
                  className="text-lg font-bold text-slate-900"
                >
                  Nhập hồ sơ khám
                </h3>
                <p className="text-sm text-slate-600 mt-0.5">
                  {mrModalAppt.patientName}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {formatSlotDate(mrModalAppt.slotTime)} ·{" "}
                  {formatSlotTime(mrModalAppt.slotTime)}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Triệu chứng
                </span>
                <textarea
                  value={mrSymptoms}
                  onChange={(e) => setMrSymptoms(e.target.value)}
                  rows={2}
                  className={`mt-1.5 ${inputBase} resize-y min-h-[3rem]`}
                  placeholder="Có thể chỉnh từ triệu chứng bệnh nhân khai báo"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Chẩn đoán
                </span>
                <textarea
                  value={mrDiagnosis}
                  onChange={(e) => setMrDiagnosis(e.target.value)}
                  rows={2}
                  className={`mt-1.5 ${inputBase} resize-y min-h-[3rem]`}
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Điều trị
                </span>
                <textarea
                  value={mrTreatment}
                  onChange={(e) => setMrTreatment(e.target.value)}
                  rows={2}
                  className={`mt-1.5 ${inputBase} resize-y min-h-[3rem]`}
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Ghi chú
                </span>
                <textarea
                  value={mrNotes}
                  onChange={(e) => setMrNotes(e.target.value)}
                  rows={2}
                  className={`mt-1.5 ${inputBase} resize-y min-h-[3rem]`}
                />
              </label>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2 mt-6">
              <button
                type="button"
                onClick={closeMedicalRecordModal}
                disabled={mrSubmitting}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={submitMedicalRecord}
                disabled={mrSubmitting}
                className="flex-1 py-2.5 bg-primary text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm hover:bg-primary/90"
              >
                {mrSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Lưu hồ sơ
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {editRecord && (
        <ModalOverlay open onClose={closeEditRecordModal}>
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-lg w-full p-6 sm:p-7 my-8 ring-1 ring-black/[0.04] relative pr-12 sm:pr-14"
            role="dialog"
            aria-modal="true"
            aria-labelledby="er-modal-title"
          >
            <ModalCloseButton
              onClose={closeEditRecordModal}
              disabled={erSubmitting}
            />
            <h3
              id="er-modal-title"
              className="text-lg font-bold text-slate-900 mb-1 pr-2"
            >
              Sửa hồ sơ khám
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              {editRecord.patientName} ·{" "}
              {editRecord.slotTime
                ? `${formatSlotDate(editRecord.slotTime)} · ${formatSlotTime(editRecord.slotTime)}`
                : new Date(editRecord.createdAt).toLocaleString("vi-VN")}
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Triệu chứng
                </span>
                <textarea
                  value={erSymptoms}
                  onChange={(e) => setErSymptoms(e.target.value)}
                  rows={2}
                  className={`mt-1.5 ${inputBase} resize-y min-h-[3rem]`}
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Chẩn đoán
                </span>
                <textarea
                  value={erDiagnosis}
                  onChange={(e) => setErDiagnosis(e.target.value)}
                  rows={2}
                  className={`mt-1.5 ${inputBase} resize-y min-h-[3rem]`}
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Điều trị
                </span>
                <textarea
                  value={erTreatment}
                  onChange={(e) => setErTreatment(e.target.value)}
                  rows={2}
                  className={`mt-1.5 ${inputBase} resize-y min-h-[3rem]`}
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Ghi chú
                </span>
                <textarea
                  value={erNotes}
                  onChange={(e) => setErNotes(e.target.value)}
                  rows={2}
                  className={`mt-1.5 ${inputBase} resize-y min-h-[3rem]`}
                />
              </label>
            </div>
            <label className="block mt-4 text-sm">
              Lý do chỉnh sửa
              <input
                className="block border rounded-lg p-2 w-full"
                value={erReason}
                maxLength={1000}
                onChange={(e) => setErReason(e.target.value)}
                required
              />
            </label>
            <MedicalRecordHistory recordId={editRecord.id} />
            <div className="flex flex-col-reverse sm:flex-row gap-2 mt-6">
              <button
                type="button"
                onClick={closeEditRecordModal}
                disabled={erSubmitting}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={submitEditRecord}
                disabled={erSubmitting}
                className="flex-1 py-2.5 bg-primary text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {erSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Lưu thay đổi
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

// ============================================================
// Sub-components
// ============================================================

interface DocTabButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
  active: boolean;
  onClick: () => void;
}

const DocTabButton: React.FC<DocTabButtonProps> = ({
  icon: Icon,
  label,
  badge,
  active,
  onClick,
}) => (
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
          active ? "bg-primary/15 text-primary" : "bg-slate-200 text-slate-600"
        }`}
      >
        {badge}
      </span>
    )}
  </button>
);

// ---------------- Overview Tab ----------------
interface OverviewTabProps {
  pendingMedical: ApiDoctorPendingMedicalAppointment[];
  pendingMedicalLoading: boolean;
  myRecords: ApiDoctorMedicalRecordListItem[];
  myRecordsLoading: boolean;
  onOpenMedicalRecord: (a: ApiDoctorPendingMedicalAppointment) => void;
  onOpenEditRecord: (r: ApiDoctorMedicalRecordListItem) => void;
  leaveRequests: ApiDoctorLeaveRequest[];
  leaveLoading: boolean;
  leaveStart: string;
  leaveEnd: string;
  leaveReason: string;
  leaveSubmitting: boolean;
  onSetLeaveStart: (v: string) => void;
  onSetLeaveEnd: (v: string) => void;
  onSetLeaveReason: (v: string) => void;
  onSubmitLeave: () => void;
}

const OverviewTab: React.FC<OverviewTabProps> = ({
  pendingMedical,
  pendingMedicalLoading,
  myRecords,
  myRecordsLoading,
  onOpenMedicalRecord,
  onOpenEditRecord,
  leaveRequests,
  leaveLoading,
  leaveStart,
  leaveEnd,
  leaveReason,
  leaveSubmitting,
  onSetLeaveStart,
  onSetLeaveEnd,
  onSetLeaveReason,
  onSubmitLeave,
}) => {
  const [pendingSearch, setPendingSearch] = useState("");
  const [recordsSearch, setRecordsSearch] = useState("");

  const filteredPending = useMemo(() => {
    const q = pendingSearch.trim().toLowerCase();
    if (!q) return pendingMedical;
    return pendingMedical.filter((a) =>
      `${a.patientName} ${a.patientEmail}`.toLowerCase().includes(q),
    );
  }, [pendingMedical, pendingSearch]);

  const filteredRecords = useMemo(() => {
    const q = recordsSearch.trim().toLowerCase();
    if (!q) return myRecords;
    return myRecords.filter((r) =>
      `${r.patientName} ${r.patientEmail}`.toLowerCase().includes(q),
    );
  }, [myRecords, recordsSearch]);

  const pendingPage = usePagination(
    filteredPending,
    PAGE_SIZE.overview,
    pendingSearch,
  );
  const recordsPage = usePagination(
    filteredRecords,
    PAGE_SIZE.overview,
    recordsSearch,
  );
  const leavePage = usePagination(leaveRequests, PAGE_SIZE.overview);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Hồ sơ sau ca khám */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-100 bg-gradient-to-r from-primary/[0.06] to-transparent flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileText className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900">
              Hồ sơ sau ca khám
            </h2>
            <p className="text-xs text-slate-500">
              Đã qua giờ ca · đã cọc/xác nhận · chưa có hồ sơ
            </p>
          </div>
          {pendingMedical.length > 0 && (
            <div className="relative shrink-0 w-44 sm:w-52">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="search"
                value={pendingSearch}
                onChange={(e) => setPendingSearch(e.target.value)}
                placeholder="Tìm bệnh nhân…"
                className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-primary/25 focus:border-primary"
              />
            </div>
          )}
        </div>
        <div className="p-4 sm:p-5">
          {pendingMedicalLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : pendingMedical.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center">
              <UserRound className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-medium text-slate-700">
                Không có ca chờ nhập hồ sơ
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Khi có lịch đủ điều kiện, sẽ hiện tại đây.
              </p>
            </div>
          ) : filteredPending.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-700">
                Không tìm thấy bệnh nhân nào khớp
              </p>
              <button
                type="button"
                onClick={() => setPendingSearch("")}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Xoá tìm kiếm
              </button>
            </div>
          ) : (
            <div className="min-h-0 max-h-[min(70vh,40rem)] overflow-y-auto overscroll-y-contain pr-1 sm:pr-2 [scrollbar-gutter:stable]">
              <ul className="space-y-3">
                {pendingPage.paginatedItems.map((a) => (
                  <li
                    key={a.id}
                    className="group flex flex-wrap items-center gap-3 rounded-xl border border-amber-200/60 bg-gradient-to-br from-amber-50/50 to-white p-4 shadow-sm hover:border-amber-300/80 hover:shadow transition-all"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white border border-amber-100 text-sm font-bold text-amber-900 shadow-sm">
                      {patientInitials(a.patientName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900">
                        {a.patientName}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {a.patientEmail}
                      </div>
                      <div className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-slate-600 bg-white/80 border border-slate-100 rounded-lg px-2 py-0.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {formatSlotDate(a.slotTime)} ·{" "}
                        {formatSlotTime(a.slotTime)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-end">
                      <button
                        type="button"
                        onClick={() => onOpenMedicalRecord(a)}
                        className="shrink-0 inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold shadow-sm hover:bg-primary/90 active:scale-[0.98] transition-transform"
                      >
                        Nhập hồ sơ
                        <ChevronRight className="w-4 h-4 opacity-90" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <ListPagination
                page={pendingPage.page}
                totalPages={pendingPage.totalPages}
                totalItems={pendingPage.totalItems}
                pageSize={pendingPage.pageSize}
                onPageChange={pendingPage.goToPage}
                itemLabel="ca chờ"
                className="pt-3 border-t border-slate-100 mt-3"
              />
            </div>
          )}
        </div>
      </section>

      {/* Hồ sơ đã lưu */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-100 bg-gradient-to-r from-sky-500/[0.06] to-transparent flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700">
            <FileText className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900">Hồ sơ đã lưu</h2>
            <p className="text-xs text-slate-500">
              Cập nhật nội dung khám (triệu chứng, chẩn đoán, điều trị)
            </p>
          </div>
          {myRecords.length > 0 && (
            <div className="relative shrink-0 w-44 sm:w-52">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="search"
                value={recordsSearch}
                onChange={(e) => setRecordsSearch(e.target.value)}
                placeholder="Tìm bệnh nhân…"
                className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-primary/25 focus:border-primary"
              />
            </div>
          )}
        </div>
        <div className="p-4 sm:p-5">
          {myRecordsLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : myRecords.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center text-sm text-slate-600">
              Chưa có hồ sơ nào. Sau khi nhập hồ sơ sau ca, danh sách sẽ hiện
              tại đây.
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-700">
                Không tìm thấy hồ sơ nào khớp
              </p>
              <button
                type="button"
                onClick={() => setRecordsSearch("")}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Xoá tìm kiếm
              </button>
            </div>
          ) : (
            <div className="min-h-0 max-h-[min(70vh,40rem)] overflow-y-auto overscroll-y-contain pr-1 sm:pr-2 [scrollbar-gutter:stable]">
              <ul className="space-y-3">
                {recordsPage.paginatedItems.map((r) => {
                  const when = r.slotTime
                    ? `${formatSlotDate(r.slotTime)} · ${formatSlotTime(r.slotTime)}`
                    : new Date(r.createdAt).toLocaleString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                  const preview =
                    [r.symptoms, r.diagnosis]
                      .filter(Boolean)
                      .join(" — ")
                      .slice(0, 120) || "(Chưa có triệu chứng/chẩn đoán)";
                  return (
                    <li
                      key={r.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-900">
                          {r.patientName}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {r.patientEmail}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {when}
                        </div>
                        <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                          {preview}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenEditRecord(r)}
                          className="px-3 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90"
                        >
                          Sửa hồ sơ
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <ListPagination
                page={recordsPage.page}
                totalPages={recordsPage.totalPages}
                totalItems={recordsPage.totalItems}
                pageSize={recordsPage.pageSize}
                onPageChange={recordsPage.goToPage}
                itemLabel="hồ sơ"
                className="pt-3 border-t border-slate-100 mt-3"
              />
            </div>
          )}
        </div>
      </section>

      {/* Xin nghỉ phép */}
      <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-100 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700">
            <Palmtree className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Xin nghỉ phép
            </h2>
            <p className="text-xs text-slate-500">Chỉ T2–T6 · quản trị duyệt</p>
          </div>
        </div>
        <div className="p-4 sm:p-5 grid lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                Từ ngày
                <input
                  type="date"
                  value={leaveStart}
                  onChange={(e) => onSetLeaveStart(e.target.value)}
                  className={inputBase}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                Đến ngày
                <input
                  type="date"
                  value={leaveEnd}
                  min={leaveStart}
                  onChange={(e) => onSetLeaveEnd(e.target.value)}
                  className={inputBase}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
              Lý do (tùy chọn)
              <input
                type="text"
                value={leaveReason}
                onChange={(e) => onSetLeaveReason(e.target.value)}
                placeholder="VD: Nghỉ phép năm"
                className={inputBase}
              />
            </label>
            <button
              type="button"
              onClick={onSubmitLeave}
              disabled={leaveSubmitting}
              className="w-full sm:w-auto px-6 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50 shadow-sm"
            >
              {leaveSubmitting ? "Đang gửi…" : "Gửi đơn xin nghỉ"}
            </button>
            <p className="text-xs text-slate-500 leading-relaxed">
              Ngày bắt đầu/kết thúc phải là <strong>thứ 2 – thứ 6</strong>. Sau
              khi duyệt, ca trống chuyển sang nghỉ phép. Nếu có ca đã đặt, quản
              trị không duyệt cho đến khi xử lý xong.
            </p>
          </div>
          <div>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              Đơn của tôi
            </h3>
            {leaveLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            ) : leaveRequests.length === 0 ? (
              <p className="text-sm text-slate-500 py-2">Chưa có đơn nào.</p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {leavePage.paginatedItems.map((r) => {
                  const workdays =
                    r.workdaysInRange?.length > 0
                      ? r.workdaysInRange
                      : listWeekdayIsoDatesInRange(r.startDate, r.endDate);
                  return (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 text-sm"
                    >
                      <div className="text-slate-800 min-w-0">
                        <div className="font-medium text-slate-900">
                          Ngày làm việc nghỉ
                        </div>
                        <div className="text-slate-600 text-xs mt-0.5 break-words">
                          {formatWorkdaysShortVi(workdays)}
                        </div>
                        {r.reason ? (
                          <div className="text-slate-500 text-xs mt-1">
                            Lý do: {r.reason}
                          </div>
                        ) : null}
                      </div>
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-lg shrink-0 ${
                          r.status === "pending"
                            ? "bg-amber-100 text-amber-900"
                            : r.status === "approved"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {leaveStatusLabel(r.status)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {!leaveLoading && leaveRequests.length > 0 && (
              <ListPagination
                page={leavePage.page}
                totalPages={leavePage.totalPages}
                totalItems={leavePage.totalItems}
                pageSize={leavePage.pageSize}
                onPageChange={leavePage.goToPage}
                itemLabel="đơn"
                className="pt-2"
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

// ---------------- Slots Tab ----------------
interface SlotsTabProps {
  slots: ApiAppointmentSlot[];
  filteredSlots: ApiAppointmentSlot[];
  stats: { free: number; booked: number; onLeave: number; total: number };
  loading: boolean;
  fromDate: string;
  toDate: string;
  statusFilter: StatusFilter;
  onSetFromAndClampTo: (v: string) => void;
  onSetToDate: (v: string) => void;
  onSetStatusFilter: (v: StatusFilter) => void;
  onApplyPreset: (n: number) => void;
  rangeMatchesPreset: (n: number) => boolean;
}

const SlotsTab: React.FC<SlotsTabProps> = ({
  slots,
  filteredSlots,
  stats,
  loading,
  fromDate,
  toDate,
  statusFilter,
  onSetFromAndClampTo,
  onSetToDate,
  onSetStatusFilter,
  onApplyPreset,
  rangeMatchesPreset,
}) => {
  const slotsPage = usePagination(
    filteredSlots,
    PAGE_SIZE.slots,
    `${fromDate}-${toDate}-${statusFilter}`,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700">
          <CalendarDays className="w-5 h-5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-slate-900">Lịch ca khám</h2>
          <p className="text-xs text-slate-500">
            Xem các ca theo khoảng ngày + trạng thái
          </p>
        </div>
      </div>

      {!loading && slots.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <StatMini label="Tổng (đang lọc)" value={stats.total} tone="slate" />
          <StatMini label="Còn trống" value={stats.free} tone="emerald" />
          <StatMini label="Đã đặt" value={stats.booked} tone="amber" />
          <StatMini label="Nghỉ phép" value={stats.onLeave} tone="neutral" />
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-2">
        <div
          className="flex gap-1 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 sm:max-w-none [scrollbar-width:thin]"
          role="group"
          aria-label="Chọn số ngày từ hôm nay"
        >
          {DAY_PRESETS.map((n) => {
            const active = rangeMatchesPreset(n);
            const label = n === 14 ? "14 ngày" : `${n} ngày`;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onApplyPreset(n)}
                className={`shrink-0 px-2 py-1 rounded-md text-xs font-semibold border transition-colors ${
                  active
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div
          className="hidden sm:block h-6 w-px bg-slate-200 shrink-0"
          aria-hidden
        />

        <div className="flex flex-wrap items-center gap-2 sm:gap-1.5">
          <label className="flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap">
            <span className="font-medium text-slate-600">Từ</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => onSetFromAndClampTo(e.target.value)}
              className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap">
            <span className="font-medium text-slate-600">Đến</span>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              onChange={(e) => onSetToDate(e.target.value)}
              className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </label>
        </div>

        <div
          className="flex flex-wrap p-0.5 rounded-lg bg-slate-200/80 border border-slate-200/60 w-full sm:w-auto sm:ml-auto gap-0.5"
          role="group"
          aria-label="Trạng thái"
        >
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSetStatusFilter(opt.id)}
              className={`flex-1 min-w-[4.5rem] sm:flex-none px-2 sm:px-2 py-1 rounded-md text-xs font-semibold transition-all ${
                statusFilter === opt.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-12 flex items-center justify-center">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        </div>
      ) : slots.length === 0 ? (
        <div className="p-12 text-center text-slate-500">
          Chưa có ca khám trong khoảng ngày đã chọn.
        </div>
      ) : filteredSlots.length === 0 ? (
        <div className="p-12 text-center text-slate-500">
          Không có ca nào khớp. Thử đổi số ngày, khoảng ngày hoặc trạng thái.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto max-h-[min(70vh,32rem)] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr className="text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Ngày
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Giờ
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Trạng thái
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {slotsPage.paginatedItems.map((s) => (
                  <tr
                    key={s.id}
                    className="hover:bg-sky-50/40 even:bg-slate-50/35 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {formatSlotDate(s.slotTime)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-2">
                        <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                        {formatSlotTime(s.slotTime)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${
                          s.status === "booked"
                            ? "bg-amber-100 text-amber-800"
                            : s.status === "on_leave"
                              ? "bg-slate-200 text-slate-800"
                              : "bg-green-100 text-green-800"
                        }`}
                      >
                        {formatStatus(s.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPagination
            page={slotsPage.page}
            totalPages={slotsPage.totalPages}
            totalItems={slotsPage.totalItems}
            pageSize={slotsPage.pageSize}
            onPageChange={slotsPage.goToPage}
            itemLabel="ca"
            className="px-4 pb-4"
          />
        </div>
      )}
    </div>
  );
};

// ---------------- Appointments Tab (Day/Week) ----------------
interface AppointmentsTabProps {
  appointments: ApiDoctorAppointment[];
  loading: boolean;
  view: CalendarView;
  anchorDate: string;
  onChangeView: (v: CalendarView) => void;
  onSetAnchorDate: (v: string) => void;
  onJumpToToday: () => void;
}

const AppointmentsTab: React.FC<AppointmentsTabProps> = ({
  appointments,
  loading,
  view,
  anchorDate,
  onChangeView,
  onSetAnchorDate,
  onJumpToToday,
}) => {
  const goPrev = () => {
    if (view === "day") {
      onSetAnchorDate(addDaysIso(anchorDate, -1));
    } else {
      const start = startOfIsoWeek(anchorDate);
      onSetAnchorDate(addDaysIso(start, -7));
    }
  };
  const goNext = () => {
    if (view === "day") {
      onSetAnchorDate(addDaysIso(anchorDate, 1));
    } else {
      const start = startOfIsoWeek(anchorDate);
      onSetAnchorDate(addDaysIso(start, 7));
    }
  };

  const headerLabel = useMemo(() => {
    if (view === "day") return formatDayHeaderLong(anchorDate);
    const start = startOfIsoWeek(anchorDate);
    const end = addDaysIso(start, 6);
    return `Tuần ${formatWeekRange(start, end)}`;
  }, [view, anchorDate]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-700">
          <CalendarClock className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">
            Lịch hẹn theo ngày / tuần
          </h2>
          <p className="text-xs text-slate-500">
            Theo dõi lịch làm việc và ca đã được đặt
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            aria-label={view === "day" ? "Ngày trước" : "Tuần trước"}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onJumpToToday}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Hôm nay
          </button>
          <button
            type="button"
            onClick={goNext}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            aria-label={view === "day" ? "Ngày sau" : "Tuần sau"}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <input
            type="date"
            value={anchorDate}
            onChange={(e) => onSetAnchorDate(e.target.value)}
            className="ml-1 px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>

        <div
          className="flex p-0.5 rounded-lg bg-slate-200/80 border border-slate-200/60 gap-0.5"
          role="group"
          aria-label="Chế độ xem lịch"
        >
          <button
            type="button"
            onClick={() => onChangeView("day")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              view === "day"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Ngày
          </button>
          <button
            type="button"
            onClick={() => onChangeView("week")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              view === "week"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <CalendarRange className="w-3.5 h-3.5" />
            Tuần
          </button>
        </div>
      </div>

      <div className="text-sm font-bold text-slate-900 capitalize">
        {headerLabel}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        </div>
      ) : view === "day" ? (
        <DayAppointmentList appointments={appointments} />
      ) : (
        <WeekAppointmentGrid
          appointments={appointments}
          weekStart={startOfIsoWeek(anchorDate)}
          onPickDay={(iso) => {
            onChangeView("day");
            onSetAnchorDate(iso);
          }}
        />
      )}
    </div>
  );
};

const DayAppointmentList: React.FC<{
  appointments: ApiDoctorAppointment[];
}> = ({ appointments }) => {
  if (appointments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
        <Stethoscope className="w-10 h-10 mx-auto text-slate-300 mb-2" />
        <p className="text-sm font-medium text-slate-700">
          Không có lịch hẹn nào trong ngày
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Bạn rảnh — hoặc chọn ngày khác để xem.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {appointments.map((a) => {
        const time = a.slot ? formatSlotTime(a.slot.slotTime) : "—";
        const badge = appointmentStatusBadge(a.status);
        return (
          <li
            key={a.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm hover:border-slate-300 transition-colors"
          >
            <div className="w-16 text-center shrink-0">
              <div className="text-lg font-bold text-slate-900 tabular-nums leading-tight">
                {time}
              </div>
              <div className="text-[10px] font-medium text-slate-400 uppercase">
                15 phút
              </div>
            </div>
            <div className="w-px h-12 bg-slate-100 shrink-0 hidden sm:block" />
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
              {patientInitials(a.patient?.fullName ?? "?")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-900 truncate">
                {a.patient?.fullName ?? "Bệnh nhân"}
              </div>
              <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                {a.patient?.email && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <Mail className="w-3 h-3" />
                    {a.patient.email}
                  </span>
                )}
                {a.patient?.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {a.patient.phone}
                  </span>
                )}
              </div>
              {a.symptoms && (
                <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                  <span className="font-medium text-slate-700">
                    Triệu chứng:{" "}
                  </span>
                  {a.symptoms}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${badge.className}`}
              >
                {badge.label}
              </span>
              {a.hasMedicalRecord && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                  <CheckCircle2 className="w-3 h-3" />
                  Đã có hồ sơ
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

const WEEK_DAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

const WeekAppointmentGrid: React.FC<{
  appointments: ApiDoctorAppointment[];
  weekStart: string;
  onPickDay: (iso: string) => void;
}> = ({ appointments, weekStart, onPickDay }) => {
  const days = useMemo(() => {
    const out: { iso: string; date: number; isToday: boolean }[] = [];
    const today = todayIso();
    for (let i = 0; i < 7; i++) {
      const iso = addDaysIso(weekStart, i);
      const d = new Date(iso + "T12:00:00");
      out.push({ iso, date: d.getDate(), isToday: iso === today });
    }
    return out;
  }, [weekStart]);

  const grouped = useMemo(() => {
    const map = new Map<string, ApiDoctorAppointment[]>();
    for (const a of appointments) {
      if (!a.slot) continue;
      const dStr = isoDateOf(new Date(a.slot.slotTime));
      const arr = map.get(dStr) ?? [];
      arr.push(a);
      map.set(dStr, arr);
    }
    for (const arr of map.values()) {
      arr.sort(
        (x, y) =>
          new Date(x.slot!.slotTime).getTime() -
          new Date(y.slot!.slotTime).getTime(),
      );
    }
    return map;
  }, [appointments]);

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d, idx) => {
        const list = grouped.get(d.iso) ?? [];
        return (
          <button
            key={d.iso}
            type="button"
            onClick={() => onPickDay(d.iso)}
            className={`text-left rounded-xl border p-2 sm:p-3 min-h-[10rem] flex flex-col gap-2 transition-all hover:border-primary/50 hover:shadow-sm ${
              d.isToday
                ? "border-primary/40 bg-primary/[0.04] ring-1 ring-primary/20"
                : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  idx >= 5 ? "text-slate-400" : "text-slate-500"
                }`}
              >
                {WEEK_DAY_LABELS[idx]}
              </span>
              <span
                className={`text-sm font-bold tabular-nums ${
                  d.isToday
                    ? "inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white"
                    : "text-slate-900"
                }`}
              >
                {d.date}
              </span>
            </div>
            {list.length === 0 ? (
              <span className="text-[10px] text-slate-400 mt-1">—</span>
            ) : (
              <ul className="space-y-1 overflow-hidden">
                {list.slice(0, 4).map((a) => {
                  const t = a.slot ? formatSlotTime(a.slot.slotTime) : "";
                  const dotColor =
                    a.status === "completed"
                      ? "bg-emerald-500"
                      : a.status === "confirmed"
                        ? "bg-sky-500"
                        : a.status === "pending"
                          ? "bg-amber-500"
                          : a.status === "cancelled"
                            ? "bg-red-400"
                            : "bg-slate-400";
                  return (
                    <li
                      key={a.id}
                      className="flex items-start gap-1.5 text-[11px] leading-snug"
                      title={`${t} - ${a.patient?.fullName ?? ""}`}
                    >
                      <span
                        className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`}
                      />
                      <span className="font-semibold text-slate-700 tabular-nums">
                        {t}
                      </span>
                      <span className="text-slate-600 truncate">
                        {a.patient?.fullName ?? "—"}
                      </span>
                    </li>
                  );
                })}
                {list.length > 4 && (
                  <li className="text-[10px] font-semibold text-primary">
                    +{list.length - 4} ca nữa
                  </li>
                )}
              </ul>
            )}
          </button>
        );
      })}
    </div>
  );
};

// ---------------- Patients Tab ----------------
interface PatientsTabProps {
  patients: ApiDoctorPatient[];
  totalCount: number;
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
}

const PatientsTab: React.FC<PatientsTabProps> = ({
  patients,
  totalCount,
  loading,
  search,
  onSearchChange,
}) => {
  const patientsPage = usePagination(patients, PAGE_SIZE.patients, search);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700">
            <Users className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Bệnh nhân của tôi
            </h2>
            <p className="text-xs text-slate-500">
              {totalCount > 0
                ? `Tổng ${totalCount} bệnh nhân từng đặt lịch`
                : "Chưa có bệnh nhân nào"}
            </p>
          </div>
        </div>
        {totalCount > 0 && (
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Tìm theo tên, email, SĐT…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-primary/25 focus:border-primary"
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        </div>
      ) : totalCount === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
          <UserRound className="w-10 h-10 mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-medium text-slate-700">
            Chưa có bệnh nhân nào đặt lịch
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Khi có bệnh nhân đặt lịch với bạn, danh sách sẽ hiển thị tại đây.
          </p>
        </div>
      ) : patients.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">
            Không tìm thấy bệnh nhân nào khớp
          </p>
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="mt-3 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5 rounded-lg"
          >
            Xoá bộ lọc
          </button>
        </div>
      ) : (
        <>
          <ul className="grid sm:grid-cols-2 gap-3">
            {patientsPage.paginatedItems.map((p) => (
              <PatientCard key={p.id} patient={p} />
            ))}
          </ul>
          <ListPagination
            page={patientsPage.page}
            totalPages={patientsPage.totalPages}
            totalItems={patientsPage.totalItems}
            pageSize={patientsPage.pageSize}
            onPageChange={patientsPage.goToPage}
            itemLabel="bệnh nhân"
          />
        </>
      )}
    </div>
  );
};

const PatientCard: React.FC<{ patient: ApiDoctorPatient }> = ({ patient }) => (
  <li className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm hover:border-slate-300 hover:shadow-md transition-all">
    <div className="flex items-start gap-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 border border-emerald-100 text-sm font-bold text-emerald-800">
        {patientInitials(patient.fullName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-slate-900 truncate">
            {patient.fullName}
          </h3>
          {patient.upcomingAppointments > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-sky-50 text-sky-700 border border-sky-200">
              {patient.upcomingAppointments} sắp tới
            </span>
          )}
          {patient.hasMedicalRecord && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              <FileText className="w-2.5 h-2.5" />
              Có hồ sơ
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 truncate mt-0.5 flex items-center gap-1">
          <Mail className="w-3 h-3 shrink-0" />
          {patient.email}
        </div>
        {patient.phone && (
          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
            <Phone className="w-3 h-3 shrink-0" />
            {patient.phone}
          </div>
        )}
      </div>
    </div>

    <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-100">
      <div>
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Tổng
        </div>
        <div className="text-lg font-bold text-slate-900 tabular-nums">
          {patient.totalAppointments}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Hoàn tất
        </div>
        <div className="text-lg font-bold text-emerald-700 tabular-nums">
          {patient.completedAppointments}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Sắp tới
        </div>
        <div className="text-lg font-bold text-sky-700 tabular-nums">
          {patient.upcomingAppointments}
        </div>
      </div>
    </div>

    <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs">
      <div>
        <div className="text-[10px] font-semibold text-slate-400 uppercase">
          Khám gần nhất
        </div>
        <div className="text-slate-700 mt-0.5">
          {formatRelativeDate(patient.lastVisitAt)}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold text-slate-400 uppercase">
          Lịch sắp tới
        </div>
        <div className="text-slate-700 mt-0.5">
          {patient.nextAppointmentAt
            ? formatRelativeDate(patient.nextAppointmentAt)
            : "—"}
        </div>
      </div>
    </div>
  </li>
);

// ---------------- Stats Tab ----------------
interface StatsTabProps {
  stats: ApiDoctorStats | null;
  loading: boolean;
  preset: StatsRangePreset;
  from: string;
  to: string;
  onApplyPreset: (p: Exclude<StatsRangePreset, "custom">) => void;
  onSetCustomRange: (next: { from?: string; to?: string }) => void;
}

const STATS_PRESETS: {
  id: Exclude<StatsRangePreset, "custom">;
  label: string;
}[] = [
  { id: "7d", label: "7 ngày" },
  { id: "30d", label: "30 ngày" },
  { id: "90d", label: "90 ngày" },
];

function formatPercent(v: number): string {
  return `${(v * 100).toFixed(v >= 0.1 ? 0 : 1)}%`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

const StatsTab: React.FC<StatsTabProps> = ({
  stats,
  loading,
  preset,
  from,
  to,
  onApplyPreset,
  onSetCustomRange,
}) => {
  const maxByDay = useMemo(() => {
    if (!stats || stats.byDay.length === 0) return 0;
    return Math.max(...stats.byDay.map((d) => d.count));
  }, [stats]);

  const maxTopCount = useMemo(() => {
    if (!stats || stats.topDiagnoses.length === 0) return 0;
    return Math.max(...stats.topDiagnoses.map((d) => d.count));
  }, [stats]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-500/10 text-fuchsia-700">
          <BarChart3 className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">
            Thống kê bệnh án
          </h2>
          <p className="text-xs text-slate-500">
            Tổng quan hoạt động khám chữa bệnh trong khoảng đã chọn
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2">
        <div
          className="flex p-0.5 rounded-lg bg-slate-200/80 border border-slate-200/60 gap-0.5 shrink-0"
          role="group"
          aria-label="Khoảng thời gian"
        >
          {STATS_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onApplyPreset(p.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                preset === p.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {p.label}
            </button>
          ))}
          <span
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              preset === "custom"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
            aria-hidden
          >
            Tùy chọn
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-1.5">
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <span className="font-medium text-slate-600">Từ</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => onSetCustomRange({ from: e.target.value })}
              className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <span className="font-medium text-slate-600">Đến</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => onSetCustomRange({ to: e.target.value })}
              className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        </div>
      ) : !stats ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center text-sm text-slate-600">
          Không tải được thống kê. Thử lại sau.
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              icon={FileText}
              label="Hồ sơ trong khoảng"
              value={stats.totalRecords}
              sublabel={`Toàn thời gian: ${stats.totalRecordsAllTime}`}
              tone="primary"
            />
            <KpiCard
              icon={Users}
              label="Bệnh nhân unique"
              value={stats.uniquePatients}
              sublabel={`Toàn thời gian: ${stats.uniquePatientsAllTime}`}
              tone="emerald"
            />
            <KpiCard
              icon={CheckCircle2}
              label="Tỷ lệ hoàn tất hồ sơ"
              value={formatPercent(stats.completionRate)}
              sublabel="Hồ sơ / ca đã qua giờ"
              tone="sky"
            />
            <KpiCard
              icon={Activity}
              label="Chờ nhập hồ sơ"
              value={stats.pendingCount}
              sublabel="Toàn thời gian"
              tone="amber"
            />
          </div>

          {/* By day chart */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Số hồ sơ theo ngày
                </h3>
                <p className="text-xs text-slate-500">
                  {formatShortDate(stats.range.from)} –{" "}
                  {formatShortDate(stats.range.to)} · cao nhất:{" "}
                  <span className="font-semibold tabular-nums">{maxByDay}</span>
                </p>
              </div>
              <span className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Activity className="w-4 h-4" />
              </span>
            </div>
            <ByDayBars data={stats.byDay} max={maxByDay} />
          </section>

          {/* Top diagnoses */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Top chẩn đoán
                </h3>
                <p className="text-xs text-slate-500">
                  10 chẩn đoán xuất hiện nhiều nhất
                </p>
              </div>
              <span className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-500/10 text-fuchsia-700">
                <PieChart className="w-4 h-4" />
              </span>
            </div>
            {stats.topDiagnoses.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">
                Chưa có chẩn đoán nào trong khoảng đã chọn.
              </p>
            ) : (
              <ul className="space-y-2">
                {stats.topDiagnoses.map((d, idx) => {
                  const pct =
                    maxTopCount > 0 ? (d.count / maxTopCount) * 100 : 0;
                  return (
                    <li
                      key={d.keyword + idx}
                      className="flex items-center gap-3"
                    >
                      <span className="w-5 text-right text-xs font-bold text-slate-400 tabular-nums">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <span
                            className="text-sm font-medium text-slate-800 truncate"
                            title={d.keyword}
                          >
                            {d.keyword}
                          </span>
                          <span className="text-xs font-bold text-slate-700 tabular-nums shrink-0">
                            {d.count}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-fuchsia-400 to-violet-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  sublabel?: string;
  tone: "primary" | "emerald" | "sky" | "amber";
}

const KpiCard: React.FC<KpiCardProps> = ({
  icon: Icon,
  label,
  value,
  sublabel,
  tone,
}) => {
  const tones = {
    primary: "bg-primary/10 text-primary",
    emerald: "bg-emerald-500/10 text-emerald-700",
    sky: "bg-sky-500/10 text-sky-700",
    amber: "bg-amber-500/10 text-amber-700",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2.5 mb-2">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}
        >
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">
        {value}
      </div>
      {sublabel ? (
        <div className="text-[11px] text-slate-500 mt-1">{sublabel}</div>
      ) : null}
    </div>
  );
};

const ByDayBars: React.FC<{
  data: { date: string; count: number }[];
  max: number;
}> = ({ data, max }) => {
  if (data.length === 0) {
    return (
      <p className="text-sm text-slate-500 text-center py-6">
        Không có dữ liệu trong khoảng đã chọn.
      </p>
    );
  }
  const showEveryNth = data.length > 21 ? Math.ceil(data.length / 12) : 1;
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div
        className="flex items-end gap-1 h-40 min-w-full"
        role="img"
        aria-label="Biểu đồ cột số hồ sơ theo ngày"
      >
        {data.map((d, idx) => {
          const h = max > 0 ? (d.count / max) * 100 : 0;
          const today = isoDateOnlyLocal(new Date());
          const isToday = d.date === today;
          return (
            <div
              key={d.date}
              className="flex-1 min-w-[10px] flex flex-col items-center justify-end gap-1 group"
              title={`${d.date}: ${d.count} hồ sơ`}
            >
              <span className="text-[9px] font-semibold tabular-nums text-slate-400 group-hover:text-slate-700 transition-colors">
                {d.count > 0 ? d.count : ""}
              </span>
              <div
                className={`w-full rounded-t-md transition-colors ${
                  d.count === 0
                    ? "bg-slate-100"
                    : isToday
                      ? "bg-gradient-to-t from-primary to-primary/70"
                      : "bg-gradient-to-t from-sky-400 to-sky-300 group-hover:from-sky-500 group-hover:to-sky-400"
                }`}
                style={{ height: `${Math.max(h, d.count > 0 ? 4 : 2)}%` }}
              />
              <span className="text-[9px] font-medium text-slate-400 tabular-nums whitespace-nowrap">
                {idx % showEveryNth === 0 ? formatShortDate(d.date) : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
