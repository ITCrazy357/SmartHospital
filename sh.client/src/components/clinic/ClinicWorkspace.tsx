import React, { useEffect, useRef, useState } from "react";
import { api, type ApiAppointmentSlot } from "../../api/client";
import {
  clinicApi,
  type ClinicDetail,
  type ClinicDoctor,
  type ClinicOnlineAppointment,
  type ClinicOperations,
  type ClinicPatient,
  type ClinicTask,
  type ClinicVisit,
} from "../../api/clinic";
import { ClinicEncounterPanel } from "./ClinicEncounterPanel";
import { ClinicFinancePanel } from "./ClinicFinancePanel";
import { ClinicPatientRegistry } from "./ClinicPatientRegistry";
import { ClinicWaitlistPanel } from "./ClinicWaitlistPanel";
import {
  amountVN,
  buttonClass,
  dateVN,
  dayVN,
  Empty,
  ErrorMessage,
  Field,
  inputClass,
  labelStatus,
  secondaryClass,
} from "./clinic-ui";

type Props = {
  user: { id: string; role?: string; fullName?: string };
  onBookWaitlist?: (doctorId: string, slotId: string) => void;
};
type Tab = "queue" | "patients" | "online" | "waitlist" | "operations";
export default function ClinicWorkspace({ user, onBookWaitlist }: Props) {
  const role = user.role ?? "user";
  const [tab, setTab] = useState<Tab>("queue");
  const [day, setDay] = useState(dayVN());
  const [status, setStatus] = useState("");
  const [visits, setVisits] = useState<ClinicVisit[]>([]);
  const [online, setOnline] = useState<ClinicOnlineAppointment[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const canReceive = ["admin", "receptionist"].includes(role);
  const tabs: { id: Tab; label: string; allowed: boolean }[] = [
    {
      id: "queue",
      label: role === "user" ? "Ca khám của tôi" : "Ca khám / hàng đợi",
      allowed: true,
    },
    { id: "patients", label: "Bệnh nhân", allowed: role !== "cashier" },
    { id: "online", label: "Tiếp nhận lịch trực tuyến", allowed: canReceive },
    {
      id: "waitlist",
      label: "Tái khám / danh sách chờ",
      allowed: role !== "cashier",
    },
    {
      id: "operations",
      label: "Theo dõi vận hành",
      allowed: ["admin", "receptionist", "cashier"].includes(role),
    },
  ];
  useEffect(() => {
    if (!["queue", "online"].includes(tab)) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    const load =
      tab === "online"
        ? clinicApi.onlineAppointments(day).then((rows) => {
            if (!cancelled) setOnline(rows);
          })
        : clinicApi.visits(day, status).then((rows) => {
            if (!cancelled) setVisits(rows);
          });
    load
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Không tải được lịch");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, day, status, refresh]);
  const refreshAll = () => setRefresh((r) => r + 1);
  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Phòng khám</h1>
          <p className="mt-1 text-sm text-slate-600">
            {user.fullName} ·{" "}
            {{
              admin: "Quản trị",
              receptionist: "Tiếp đón",
              cashier: "Thu ngân",
              doctor: "Bác sĩ",
              user: "Bệnh nhân",
            }[role] ?? role}
          </p>
        </div>
        <button className={secondaryClass} onClick={refreshAll}>
          Tải lại dữ liệu
        </button>
      </header>
      <nav
        className="flex gap-2 overflow-x-auto pb-2"
        aria-label="Nghiệp vụ phòng khám"
      >
        {tabs
          .filter((t) => t.allowed)
          .map((t) => (
            <button
              key={t.id}
              className={`shrink-0 ${tab === t.id ? buttonClass : secondaryClass}`}
              onClick={() => {
                setTab(t.id);
                setSelected(null);
                setError(null);
              }}
            >
              {t.label}
            </button>
          ))}
      </nav>
      <ErrorMessage message={error} />
      {["queue", "online"].includes(tab) && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Ngày khám (giờ Việt Nam)">
            <input
              type="date"
              required
              className={inputClass}
              value={day}
              onChange={(e) => {
                if (e.target.value) setDay(e.target.value);
              }}
            />
          </Field>
          {tab === "queue" && (
            <Field label="Trạng thái">
              <select
                className={inputClass}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Tất cả</option>
                {[
                  "scheduled",
                  "checked_in",
                  "in_consultation",
                  "completed",
                  "no_show",
                  "cancelled",
                ].map((s) => (
                  <option key={s} value={s}>
                    {labelStatus(s)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}
      {tab === "queue" && (
        <div className="space-y-5">
          {canReceive && <CreateVisit onSaved={refreshAll} />}
          <section className="space-y-3" aria-busy={busy}>
            {!visits.length ? (
              <Empty>
                {busy ? "Đang tải…" : "Không có ca khám trong ngày."}
              </Empty>
            ) : (
              visits.map((v) => (
                <article
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <div>
                    <strong>{v.patient_name}</strong>
                    <p className="mt-1 text-sm text-slate-600">
                      {v.patient_code} · Số tiếp đón {v.queue_number} ·{" "}
                      {dateVN(v.scheduled_at)}
                    </p>
                    <p className="text-sm">
                      {v.doctor_name} ·{" "}
                      <span className="font-semibold">
                        {labelStatus(v.status)}
                      </span>
                    </p>
                    {role === "cashier" && (
                      <p className="text-sm">
                        Phí: {amountVN(v.consultation_fee)} · Đã ghi nhận:{" "}
                        {amountVN(v.paid_amount)}
                      </p>
                    )}
                  </div>
                  <button
                    className={secondaryClass}
                    onClick={() => setSelected(v.id)}
                  >
                    Mở ca khám
                  </button>
                </article>
              ))
            )}
          </section>
        </div>
      )}
      {tab === "online" && (
        <section className="space-y-3">
          <p className="text-sm text-slate-600">
            Tiếp nhận lịch đã xác nhận vào danh sách ca khám. Tiền cọc đã thanh
            toán được liên kết một lần; check-in thực hiện khi bệnh nhân đến.
          </p>
          {!online.length ? (
            <Empty>
              {busy
                ? "Đang tải…"
                : "Không có lịch trực tuyến đã xác nhận trong ngày."}
            </Empty>
          ) : (
            online.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap justify-between gap-3 rounded-xl border p-4"
              >
                <div>
                  <strong>{a.patient_name}</strong>
                  <p className="text-sm text-slate-600">
                    {a.phone || "Chưa có SĐT"} · {a.doctor_name} ·{" "}
                    {dateVN(a.slot_time)}
                  </p>
                </div>
                <button
                  className={buttonClass}
                  disabled={busy || a.imported}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const visit = await clinicApi.importAppointment(a.id);
                      setSelected(visit.id);
                      refreshAll();
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Không tiếp nhận được lịch",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {a.imported ? "Đã tiếp nhận" : "Tiếp nhận lịch"}
                </button>
              </div>
            ))
          )}
        </section>
      )}
      {tab === "patients" && <ClinicPatientRegistry role={role} />}
      {tab === "waitlist" && (
        <ClinicWaitlistPanel role={role} onBookWaitlist={onBookWaitlist} />
      )}
      {tab === "operations" && (
        <Operations
          key={refresh}
          role={role}
          userId={user.id}
          onOpen={setSelected}
          onRefresh={refreshAll}
        />
      )}
      {selected && (
        <VisitDetail
          key={selected}
          id={selected}
          role={role}
          userId={user.id}
          onClose={() => setSelected(null)}
          onSaved={refreshAll}
        />
      )}
    </div>
  );
}

function CreateVisit({ onSaved }: { onSaved: () => void }) {
  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [doctors, setDoctors] = useState<ClinicDoctor[]>([]);
  const [slots, setSlots] = useState<ApiAppointmentSlot[]>([]);
  const [patientQuery, setPatientQuery] = useState("");
  const [patient, setPatient] = useState("");
  const [doctor, setDoctor] = useState("");
  const [source, setSource] = useState("walk_in");
  const [slot, setSlot] = useState("");
  const [fee, setFee] = useState("50000");
  const [symptoms, setSymptoms] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      clinicApi.patients(),
      clinicApi.doctors(),
      api.getBookingPolicy(),
    ])
      .then(([p, d, policy]) => {
        if (!cancelled) {
          setPatients(p);
          setDoctors(d);
          setFee(String(policy.consultationFee));
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Không tải được dữ liệu đăng ký",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    setSlot("");
    if (!doctor || source !== "phone") {
      setSlots([]);
      return;
    }
    let cancelled = false;
    api
      .getDoctorSlots(doctor, dayVN())
      .then((s) => {
        if (!cancelled)
          setSlots(
            s.filter((row) => new Date(row.slotTime).getTime() > Date.now()),
          );
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Không tải được khung giờ");
      });
    return () => {
      cancelled = true;
    };
  }, [doctor, source]);
  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-bold">
        Đăng ký tại quầy / qua điện thoại
      </summary>
      <form
        className="mt-4 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await clinicApi.createVisit({
              patientId: patient,
              doctorId: doctor,
              source,
              slotId: source === "phone" ? slot : undefined,
              scheduledAt:
                source === "phone"
                  ? slots.find((s) => s.id === slot)?.slotTime
                  : new Date().toISOString(),
              consultationFee: Number(fee),
              symptoms,
            });
            setSymptoms("");
            setPatient("");
            setSlot("");
            onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Không đăng ký được ca");
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorMessage message={error} />
        <div className="flex gap-2">
          <input
            aria-label="Tìm bệnh nhân đăng ký khám"
            className={inputClass}
            placeholder="Tìm mã bệnh nhân, họ tên hoặc SĐT"
            value={patientQuery}
            onChange={(e) => setPatientQuery(e.target.value)}
          />
          <button
            type="button"
            className={secondaryClass}
            disabled={busy}
            onClick={async () => {
              try {
                setPatients(await clinicApi.patients(patientQuery));
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Không tìm được bệnh nhân",
                );
              }
            }}
          >
            Tìm
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Bệnh nhân">
            <select
              required
              className={inputClass}
              value={patient}
              onChange={(e) => setPatient(e.target.value)}
            >
              <option value="">Chọn bệnh nhân</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} · {p.patient_code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bác sĩ">
            <select
              required
              className={inputClass}
              value={doctor}
              onChange={(e) => setDoctor(e.target.value)}
            >
              <option value="">Chọn bác sĩ</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hình thức đăng ký">
            <select
              className={inputClass}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="walk_in">Đến tại quầy (thời điểm hiện tại)</option>
              <option value="phone">Qua điện thoại (giữ khung giờ)</option>
            </select>
          </Field>
        </div>
        {source === "phone" && (
          <Field label="Khung giờ bác sĩ còn trống">
            <select
              required
              className={inputClass}
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
            >
              <option value="">Chọn khung giờ</option>
              {slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {dateVN(s.slotTime)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Phí khám đã thông báo cho bệnh nhân (VND)">
          <input
            required
            min="0"
            max="1000000000"
            step="1"
            type="number"
            className={inputClass}
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
        </Field>
        <Field label="Lý do đến khám">
          <textarea
            maxLength={4000}
            className={inputClass}
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
          />
        </Field>
        <p className="text-xs text-slate-500">
          Nếu chưa có mã bệnh nhân, tạo ở tab Bệnh nhân trước. Đăng ký chưa đồng
          nghĩa đã đến khám hoặc đã thu tiền.
        </p>
        <button
          className={buttonClass}
          disabled={
            busy || !patient || !doctor || (source === "phone" && !slot)
          }
        >
          {busy ? "Đang đăng ký…" : "Đăng ký ca khám"}
        </button>
      </form>
    </details>
  );
}

function VisitDetail({
  id,
  role,
  userId,
  onClose,
  onSaved,
}: {
  id: string;
  role: string;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<ClinicDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [onlineCancelReason, setOnlineCancelReason] = useState("");
  const [onlineCancelConfirmed, setOnlineCancelConfirmed] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    clinicApi
      .detail(id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Không tải được ca khám");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, refresh]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key !== "Tab") return;
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"],summary',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === items[0] ||
          document.activeElement === panelRef.current)
      ) {
        e.preventDefault();
        items.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
        e.preventDefault();
        items[0].focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);
  const saved = () => {
    setRefresh((v) => v + 1);
    onSaved();
  };
  const transition = async (status: string) => {
    if (!detail) return;
    const reason =
      status === "cancelled" ? window.prompt("Lý do hủy ca khám") : null;
    if (status === "cancelled" && !reason?.trim()) return;
    if (!window.confirm(`Chuyển ca sang trạng thái “${labelStatus(status)}”?`))
      return;
    setBusy(true);
    setError(null);
    try {
      await clinicApi.transition(id, {
        status,
        version: detail.visit.version,
        reason,
      });
      saved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đổi được trạng thái");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 px-3 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clinic-visit-title"
    >
      <section
        ref={panelRef}
        tabIndex={-1}
        className="mx-auto max-w-4xl space-y-5 rounded-2xl bg-white p-4 shadow-xl sm:p-6"
      >
        <header className="flex items-start justify-between gap-3">
          <h2 id="clinic-visit-title" className="text-xl font-bold">
            {detail
              ? `${detail.patient.full_name} · ${detail.patient.patient_code}`
              : "Ca khám"}
          </h2>
          <button className={secondaryClass} disabled={busy} onClick={onClose}>
            Đóng
          </button>
        </header>
        <ErrorMessage message={error} />
        {!detail ? (
          <Empty>{busy ? "Đang tải…" : "Không có dữ liệu."}</Empty>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              {dateVN(detail.visit.scheduled_at)} ·{" "}
              {labelStatus(detail.visit.status)} · Số tiếp đón{" "}
              {detail.visit.queue_number}
            </p>
            <div className="flex flex-wrap gap-2">
              {["admin", "receptionist"].includes(role) &&
                detail.visit.status === "scheduled" && (
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => void transition("checked_in")}
                  >
                    Check-in: bệnh nhân đã đến
                  </button>
                )}
              {["admin", "doctor"].includes(role) &&
                detail.visit.status === "checked_in" && (
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => void transition("in_consultation")}
                  >
                    Bắt đầu khám
                  </button>
                )}
              {["admin", "receptionist"].includes(role) &&
                ["scheduled", "checked_in"].includes(detail.visit.status) && (
                  <>
                    <button
                      className={secondaryClass}
                      disabled={
                        busy ||
                        new Date(detail.visit.scheduled_at).getTime() >
                          Date.now()
                      }
                      onClick={() => void transition("no_show")}
                    >
                      Ghi vắng mặt
                    </button>
                    {!detail.visit.appointment_id && (
                      <button
                        className={secondaryClass}
                        disabled={busy}
                        onClick={() => void transition("cancelled")}
                      >
                        Hủy ca
                      </button>
                    )}
                  </>
                )}
            </div>
            {role === "admin" &&
              detail.visit.appointment_id &&
              ["scheduled", "checked_in", "no_show"].includes(
                detail.visit.status,
              ) && (
                <details className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <summary className="cursor-pointer font-semibold">
                    Hủy lịch trực tuyến đã tiếp nhận
                  </summary>
                  <Field label="Lý do hủy lịch">
                    <textarea
                      className={inputClass}
                      maxLength={1000}
                      value={onlineCancelReason}
                      onChange={(e) => setOnlineCancelReason(e.target.value)}
                      disabled={busy}
                    />
                  </Field>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={onlineCancelConfirmed}
                      onChange={(e) =>
                        setOnlineCancelConfirmed(e.target.checked)
                      }
                      disabled={busy}
                    />
                    Tôi xác nhận đã kiểm tra ca khám và thông báo cho bệnh nhân.
                    Hủy lịch không tự động hoàn cọc.
                  </label>
                  <button
                    className={buttonClass}
                    disabled={
                      busy ||
                      !onlineCancelConfirmed ||
                      !onlineCancelReason.trim()
                    }
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await api.adminCancelAppointment(
                          detail.visit.appointment_id!,
                          onlineCancelReason.trim(),
                        );
                        setOnlineCancelConfirmed(false);
                        saved();
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Không hủy được lịch",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Xác nhận hủy lịch và trả ca trống
                  </button>
                </details>
              )}
            {["admin", "doctor", "user"].includes(role) && (
              <ClinicEncounterPanel
                key={`encounter-${detail.encounter?.version ?? 0}-${detail.visit.version}-${detail.medicalRecordVersion}`}
                detail={detail}
                role={role}
                onSaved={saved}
              />
            )}
            {["admin", "cashier", "user"].includes(role) && (
              <ClinicFinancePanel
                key={`finance-${detail.ledger.length}-${detail.refunds.map((r) => `${r.id}-${r.status}`).join("-")}`}
                detail={detail}
                userId={userId}
                role={role}
                onSaved={saved}
              />
            )}
            {role === "receptionist" && (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                Nội dung hồ sơ chuyên môn và giao dịch được phân quyền riêng cho
                bác sĩ/thu ngân.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Operations({
  role,
  userId,
  onOpen,
  onRefresh,
}: {
  role: string;
  userId: string;
  onOpen: (id: string) => void;
  onRefresh: () => void;
}) {
  const [data, setData] = useState<ClinicOperations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<ClinicTask[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all([clinicApi.operations(), clinicApi.tasks()])
      .then(([d, t]) => {
        if (!cancelled) {
          setData(d);
          setTasks(t);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Không tải được theo dõi vận hành",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const claimButton = (kind: string, target: string) => {
    const task = tasks.find((t) => t.kind === kind && t.target_id === target);
    if (task)
      return (
        <p className="mt-2 text-xs text-slate-600">
          Phụ trách: {task.assignee_name} ·{" "}
          {task.status === "resolved" ? "Đã ghi nhận xử lý" : "Đang xử lý"}
        </p>
      );
    return (
      <button
        className={`${secondaryClass} mt-2`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await clinicApi.claimTask(kind, target);
            onRefresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Không nhận được việc");
          } finally {
            setBusy(false);
          }
        }}
      >
        Nhận xử lý
      </button>
    );
  };
  return (
    <div className="space-y-5">
      <ErrorMessage message={error} />
      {!data ? (
        <Empty>Đang tải…</Empty>
      ) : (
        <>
          {role !== "cashier" && (
            <section className="space-y-2">
              <h3 className="font-bold">Lịch trực tuyến chưa tiếp nhận</h3>
              {!data.unimported.length ? (
                <Empty>Không có lịch tồn.</Empty>
              ) : (
                data.unimported.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                  >
                    <p>
                      {a.patient_name} · {dateVN(a.slot_time)}
                    </p>
                    <button
                      className={buttonClass}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const row = await clinicApi.importAppointment(a.id);
                          onOpen(row.id);
                          onRefresh();
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : "Không tiếp nhận được",
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Tiếp nhận
                    </button>
                  </div>
                ))
              )}
            </section>
          )}
          <section className="space-y-2">
            <h3 className="font-bold">Ca chờ / hồ sơ chưa hoàn tất</h3>
            {!data.unfinished.length ? (
              <Empty>Không có ca đang chờ xử lý.</Empty>
            ) : (
              data.unfinished.map((v) => (
                <div key={v.id} className="rounded-xl border p-3">
                  <button
                    className="block w-full text-left"
                    onClick={() => onOpen(v.id)}
                  >
                    {v.patient_name} · {v.doctor_name}
                    <span className="block text-sm text-slate-600">
                      {labelStatus(v.status)} · {dateVN(v.scheduled_at)}
                    </span>
                  </button>
                  {role !== "cashier" && claimButton("visit", v.id)}
                </div>
              ))
            )}
          </section>
          {["admin", "cashier"].includes(role) && (
            <>
              <section className="space-y-2">
                <h3 className="font-bold">Giao dịch cần đối soát</h3>
                {!data.reconciliation.length ? (
                  <Empty>Không có giao dịch lệch.</Empty>
                ) : (
                  data.reconciliation.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"
                    >
                      <strong>{amountVN(p.amount)}</strong> · Mã PayOS{" "}
                      {p.payos_order_code}
                      <p>
                        Thanh toán: {p.status} · Lịch hẹn:{" "}
                        {p.appointment_status}
                      </p>
                      <p className="mt-1">
                        Tiếp nhận tiền cọc đã xác nhận của lịch hủy để đề nghị
                        hoàn/chuyển. Không khôi phục lịch khám và không tự
                        chuyển tiền.
                      </p>
                      <Field label="Ghi chú kiểm tra giao dịch">
                        <textarea
                          className={inputClass}
                          maxLength={1000}
                          value={notes[p.id] ?? ""}
                          onChange={(e) =>
                            setNotes((prev) => ({
                              ...prev,
                              [p.id]: e.target.value,
                            }))
                          }
                        />
                      </Field>
                      <button
                        className={`${buttonClass} mt-2`}
                        disabled={
                          busy ||
                          p.status !== "paid" ||
                          p.appointment_status !== "cancelled" ||
                          !(notes[p.id] ?? "").trim()
                        }
                        onClick={async () => {
                          if (
                            !window.confirm(
                              "Tiếp nhận đúng giao dịch cọc đã kiểm tra để xử lý hoàn/chuyển thủ công?",
                            )
                          )
                            return;
                          setBusy(true);
                          setError(null);
                          try {
                            const visit = await clinicApi.reconcilePayment(
                              p.id,
                              { confirmed: true, note: notes[p.id].trim() },
                            );
                            onOpen(visit.id);
                            onRefresh();
                          } catch (e) {
                            setError(
                              e instanceof Error
                                ? e.message
                                : "Không tiếp nhận được giao dịch",
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Tiếp nhận / mở xử lý cọc
                      </button>
                      {p.status !== "paid" && (
                        <p className="mt-2 text-xs">
                          Chưa có khoản tiền đã xác nhận. Giữ công việc đối soát
                          để kiểm tra với nhà cung cấp; không ghi nhận số tiền
                          suy đoán.
                        </p>
                      )}
                      {claimButton("reconciliation", p.id)}
                    </div>
                  ))
                )}
              </section>
              <section className="space-y-2">
                <h3 className="font-bold">Đề nghị hoàn cần xử lý</h3>
                {!data.refunds.length ? (
                  <Empty>Không có đề nghị tồn.</Empty>
                ) : (
                  data.refunds.map((r) => (
                    <div key={r.id} className="rounded-xl border p-3">
                      <button
                        className="block w-full text-left"
                        onClick={() => onOpen(r.visit_id)}
                      >
                        {r.patient_name} · {amountVN(r.amount)}
                        <span className="block text-sm">
                          {labelStatus(r.status)} · {r.reason}
                        </span>
                      </button>
                      {claimButton("refund", r.id)}
                    </div>
                  ))
                )}
              </section>
            </>
          )}
          {role !== "cashier" && (
            <section className="space-y-2">
              <h3 className="font-bold">Email nhắc lịch lỗi / đang xử lý</h3>
              {!data.reminders.length ? (
                <Empty>Không có tác vụ lỗi hoặc đang giữ.</Empty>
              ) : (
                data.reminders.map((r) => (
                  <div
                    key={`${r.appointment_id}-${r.kind}`}
                    className="rounded-xl border p-3 text-sm"
                  >
                    <strong>
                      Mốc {r.kind} · {r.status}
                    </strong>
                    <p>
                      Số lần thử: {r.attempts} · Lần thử tiếp:{" "}
                      {dateVN(r.next_attempt_at)}
                    </p>
                    <p className="break-words text-red-700">
                      {r.last_error ||
                        "Đang xử lý; hệ thống sẽ tự thu hồi nếu hết hạn giữ tác vụ."}
                    </p>
                    {claimButton("reminder", r.appointment_id)}
                  </div>
                ))
              )}
            </section>
          )}
          <section className="space-y-3">
            <h3 className="font-bold">Người phụ trách và nhật ký xử lý</h3>
            {!tasks.length ? (
              <Empty>
                Nhận xử lý một ngoại lệ ở trên để theo dõi người phụ trách.
              </Empty>
            ) : (
              tasks.map((t) => (
                <article
                  key={t.id}
                  className="space-y-2 rounded-xl border p-3 text-sm"
                >
                  <strong>
                    {{
                      visit: "Ca chưa hoàn tất",
                      refund: "Đề nghị hoàn",
                      reconciliation: "Đối soát",
                      reminder: "Nhắc lịch",
                    }[t.kind] ?? t.kind}{" "}
                    · {t.target_label}
                  </strong>
                  <p>
                    {t.assignee_name} ·{" "}
                    {t.status === "resolved"
                      ? "Đã ghi nhận xử lý"
                      : "Đang xử lý"}{" "}
                    · {dateVN(t.updated_at)}
                  </p>
                  {t.note && <p className="whitespace-pre-wrap">{t.note}</p>}
                  {(t.assigned_to === userId || role === "admin") && (
                    <>
                      <Field label="Ghi chú / kết quả xử lý">
                        <textarea
                          maxLength={1000}
                          className={inputClass}
                          value={notes[t.id] ?? ""}
                          onChange={(e) =>
                            setNotes((prev) => ({
                              ...prev,
                              [t.id]: e.target.value,
                            }))
                          }
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        {["in_progress", "resolved"].map((status) => (
                          <button
                            key={status}
                            className={
                              status === "resolved"
                                ? buttonClass
                                : secondaryClass
                            }
                            disabled={busy || !(notes[t.id] ?? "").trim()}
                            onClick={async () => {
                              setBusy(true);
                              setError(null);
                              try {
                                await clinicApi.updateTask(t.id, {
                                  status,
                                  version: t.version,
                                  note: notes[t.id],
                                });
                                onRefresh();
                              } catch (e) {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : "Không cập nhật được việc",
                                );
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            {status === "resolved"
                              ? "Ghi nhận đã xử lý"
                              : "Lưu tiến độ"}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </article>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
