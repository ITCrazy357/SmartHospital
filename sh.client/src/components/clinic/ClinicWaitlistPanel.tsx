import React, { useEffect, useState } from "react";
import { api, type ApiAppointmentSlot } from "../../api/client";
import {
  clinicApi,
  type ClinicDoctor,
  type ClinicFollowup,
  type ClinicPatient,
  type ClinicWaitlist,
} from "../../api/clinic";
import {
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

export function ClinicWaitlistPanel({
  role,
  onBookWaitlist,
}: {
  role: string;
  onBookWaitlist?: (doctorId: string, slotId: string) => void;
}) {
  const [rows, setRows] = useState<ClinicWaitlist[]>([]);
  const [followUps, setFollowUps] = useState<ClinicFollowup[]>([]);
  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [doctors, setDoctors] = useState<ClinicDoctor[]>([]);
  const [patient, setPatient] = useState("");
  const [doctor, setDoctor] = useState("");
  const [date, setDate] = useState(dayVN());
  const [note, setNote] = useState("");
  const [patientQuery, setPatientQuery] = useState("");
  const [offering, setOffering] = useState<ClinicWaitlist | null>(null);
  const [slots, setSlots] = useState<ApiAppointmentSlot[]>([]);
  const [slotId, setSlotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const canManage = ["admin", "receptionist"].includes(role);
  const canAdd = canManage || role === "user";
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    Promise.all([
      clinicApi.waitlist(),
      clinicApi.followUps(),
      clinicApi.patients(),
      clinicApi.doctors(),
    ])
      .then(([wait, follow, p, d]) => {
        if (!cancelled) {
          setRows(wait);
          setFollowUps(follow);
          setPatients(p);
          setDoctors(d);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Không tải được dữ liệu");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setRefresh((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thực hiện được");
    } finally {
      setBusy(false);
    }
  };
  const offer = async (row: ClinicWaitlist) => {
    setError(null);
    setSlotId("");
    setOffering(row);
    try {
      const available = await api.getDoctorSlots(row.doctor_id, dayVN());
      setSlots(
        available.filter(
          (s) =>
            s.status === "available" &&
            new Date(s.slotTime).getTime() > Date.now(),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được khung giờ");
    }
  };
  return (
    <div className="space-y-6">
      <ErrorMessage message={error} />
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      <section className="space-y-3">
        <h3 className="font-bold">Lịch tái khám đã được bác sĩ xác nhận</h3>
        {!followUps.length ? (
          <Empty>Chưa có đề nghị tái khám.</Empty>
        ) : (
          followUps.map((f) => (
            <div
              key={f.visit_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
            >
              <div>
                <strong>{f.patient_name}</strong>
                <p className="text-sm text-slate-600">
                  {f.patient_code} · {f.doctor_name} · Ngày tái khám:{" "}
                  {f.follow_up_date.slice(0, 10)}
                </p>
              </div>
              {canAdd && (
                <button
                  className={secondaryClass}
                  disabled={busy}
                  onClick={() => {
                    setPatient(f.patient_id);
                    setDoctor(f.doctor_id);
                    setDate(f.follow_up_date.slice(0, 10));
                    setNote(
                      "Đăng ký theo mốc tái khám đã được bác sĩ xác nhận",
                    );
                  }}
                >
                  Đưa vào danh sách chờ
                </button>
              )}
            </div>
          ))
        )}
      </section>
      {canAdd && (
        <form
          className="space-y-3 rounded-2xl border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await clinicApi.addWaitlist({
                patientId: patient,
                doctorId: doctor,
                preferredDate: date,
                note,
              });
              setNote("");
              setNotice("Đã thêm yêu cầu chờ. Chưa đặt lịch hoặc thu tiền.");
            });
          }}
        >
          <h3 className="font-bold">Đăng ký chờ khung giờ / tái khám</h3>
          <div className="flex gap-2">
            <input
              aria-label="Tìm bệnh nhân đăng ký chờ"
              className={inputClass}
              placeholder="Tìm bệnh nhân"
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
          <div className="grid gap-3 sm:grid-cols-3">
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
                {patient && !patients.some((p) => p.id === patient) && (
                  <option value={patient}>
                    {followUps.find((f) => f.patient_id === patient)
                      ?.patient_name ?? "Bệnh nhân tái khám"}
                  </option>
                )}
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
            <Field label="Ngày mong muốn">
              <input
                required
                type="date"
                min={dayVN()}
                className={inputClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Ghi chú">
            <textarea
              maxLength={1000}
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <button
            className={buttonClass}
            disabled={busy || !patient || !doctor}
          >
            Đăng ký chờ
          </button>
        </form>
      )}
      <section className="space-y-3">
        <h3 className="font-bold">Danh sách chờ</h3>
        {!rows.length ? (
          <Empty>Chưa có yêu cầu chờ.</Empty>
        ) : (
          rows.map((row) => (
            <article key={row.id} className="space-y-2 rounded-xl border p-4">
              <strong>
                {row.patient_name} · {labelStatus(row.status)}
              </strong>
              <p className="text-sm text-slate-600">
                {row.doctor_name} · Ngày mong muốn:{" "}
                {row.preferred_date.slice(0, 10)}
              </p>
              {row.note && <p className="text-sm">{row.note}</p>}
              {row.slot_time && (
                <p className="text-sm font-medium">
                  Khung giờ đề nghị: {dateVN(row.slot_time)}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {canManage && ["waiting", "offered"].includes(row.status) && (
                  <button
                    className={secondaryClass}
                    disabled={busy}
                    onClick={() => void offer(row)}
                  >
                    Đề nghị khung giờ
                  </button>
                )}
                {(canManage || role === "user") && row.status === "offered" && (
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Xác nhận bệnh nhân đồng ý khung giờ? Bạn vẫn cần hoàn tất bước đặt lịch để giữ chỗ.",
                        )
                      )
                        return;
                      void action(async () => {
                        const confirmed = await clinicApi.confirmWaitlist(
                          row.id,
                        );
                        setNotice(
                          "Đã ghi nhận đồng ý. Khung giờ chưa được giữ; hoàn tất đặt lịch và thanh toán theo luồng thông thường.",
                        );
                        if (
                          role === "user" &&
                          confirmed.offered_slot_id &&
                          onBookWaitlist
                        )
                          onBookWaitlist(
                            confirmed.doctor_id,
                            confirmed.offered_slot_id,
                          );
                      });
                    }}
                  >
                    Đồng ý khung giờ
                  </button>
                )}
                {role === "user" &&
                  row.status === "confirmed" &&
                  onBookWaitlist &&
                  row.offered_slot_id && (
                    <button
                      className={buttonClass}
                      onClick={() =>
                        onBookWaitlist(row.doctor_id, row.offered_slot_id!)
                      }
                    >
                      Tiếp tục đặt lịch
                    </button>
                  )}
                {(canManage || role === "user") &&
                  row.status !== "cancelled" && (
                    <button
                      className={secondaryClass}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Hủy yêu cầu chờ này?"))
                          void action(() => clinicApi.cancelWaitlist(row.id));
                      }}
                    >
                      Hủy yêu cầu
                    </button>
                  )}
              </div>
            </article>
          ))
        )}
      </section>
      {offering && (
        <section className="space-y-3 rounded-2xl border border-primary bg-primary/5 p-4">
          <h3 className="font-bold">Đề nghị giờ cho {offering.patient_name}</h3>
          <Field label="Khung giờ còn trống">
            <select
              className={inputClass}
              value={slotId}
              onChange={(e) => setSlotId(e.target.value)}
            >
              <option value="">Chọn khung giờ</option>
              {slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {dateVN(s.slotTime)}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-sm text-slate-600">
            Khung giờ chỉ được đề nghị, không tự đặt hoặc tự thu tiền.
          </p>
          <div className="flex gap-2">
            <button
              className={buttonClass}
              disabled={busy || !slotId}
              onClick={() =>
                void action(async () => {
                  await clinicApi.offerWaitlist(offering.id, slotId);
                  setOffering(null);
                })
              }
            >
              Gửi đề nghị trong ứng dụng
            </button>
            <button
              className={secondaryClass}
              onClick={() => setOffering(null)}
            >
              Đóng
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
