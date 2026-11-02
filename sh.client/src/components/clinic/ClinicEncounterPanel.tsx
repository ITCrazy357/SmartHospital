import React, { useState } from "react";
import { clinicApi, type ClinicDetail } from "../../api/clinic";
import {
  buttonClass,
  dateVN,
  ErrorMessage,
  Field,
  inputClass,
  labelStatus,
  printClinic,
  printableStyle,
  secondaryClass,
} from "./clinic-ui";

export function ClinicEncounterPanel({
  detail,
  role,
  onSaved,
}: {
  detail: ClinicDetail;
  role: string;
  onSaved: () => void;
}) {
  const record = detail.encounter ?? detail.legacyMedicalRecord;
  const [symptoms, setSymptoms] = useState(
    record?.symptoms ?? detail.visit.symptoms ?? "",
  );
  const [diagnosis, setDiagnosis] = useState(record?.diagnosis ?? "");
  const [treatment, setTreatment] = useState(record?.treatment ?? "");
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [followUp, setFollowUp] = useState(
    detail.encounter?.follow_up_date?.slice(0, 10) ?? "",
  );
  const [measurements, setMeasurements] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(detail.encounter?.vitals ?? {}).map(([k, v]) => [
        k,
        String(v),
      ]),
    ),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit =
    ["doctor", "admin"].includes(role) &&
    ["in_consultation", "completed"].includes(detail.visit.status);
  const save = async (finalize: boolean) => {
    if (
      finalize &&
      !window.confirm(
        "Xác nhận kết quả khám và hoàn tất ca? Mọi thay đổi tiếp theo sẽ được lưu thành phiên bản mới.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await clinicApi.encounter(detail.visit.id, {
        symptoms,
        diagnosis,
        treatment,
        notes,
        followUpDate: followUp || null,
        reason,
        finalize,
        version: detail.encounter?.version ?? 0,
        medicalRecordVersion: detail.medicalRecordVersion,
        vitals: Object.fromEntries(
          Object.entries(measurements)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, Number(v)]),
        ),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được hồ sơ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <ErrorMessage message={error} />
      {canEdit ? (
        <section className="space-y-4 rounded-2xl border border-slate-200 p-4">
          <h3 className="font-bold">
            Hồ sơ khám —{" "}
            {detail.encounter
              ? `${labelStatus(detail.encounter.status)}, phiên bản ${detail.encounter.version}`
              : "Chưa có bản nháp"}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["temperature", "Nhiệt độ (°C)", "0.1"],
              ["heartRate", "Mạch (lần/phút)", "1"],
              ["systolic", "Huyết áp tâm thu (mmHg)", "1"],
              ["diastolic", "Huyết áp tâm trương (mmHg)", "1"],
              ["weight", "Cân nặng (kg)", "0.1"],
              ["height", "Chiều cao (cm)", "0.1"],
              ["oxygen", "SpO₂ (%)", "0.1"],
            ].map(([key, label, step]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  step={step}
                  className={inputClass}
                  value={measurements[key] ?? ""}
                  onChange={(e) =>
                    setMeasurements((m) => ({ ...m, [key]: e.target.value }))
                  }
                  disabled={busy}
                />
              </Field>
            ))}
          </div>
          <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <strong>Dị ứng:</strong>{" "}
            {detail.patient.allergies || "Chưa ghi nhận"}
            <br />
            <strong>Tiền sử:</strong>{" "}
            {detail.patient.medical_history || "Chưa ghi nhận"}
          </div>
          {(
            [
              ["Triệu chứng", symptoms, setSymptoms],
              ["Chẩn đoán", diagnosis, setDiagnosis],
              ["Điều trị / hướng dẫn", treatment, setTreatment],
              ["Ghi chú", notes, setNotes],
            ] as const
          ).map(([label, value, setter]) => (
            <Field key={label} label={label}>
              <textarea
                maxLength={4000}
                rows={3}
                className={inputClass}
                value={value}
                onChange={(e) => setter(e.target.value)}
                disabled={busy}
              />
            </Field>
          ))}
          <Field label="Ngày tái khám (do bác sĩ xác nhận)">
            <input
              type="date"
              className={inputClass}
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="Lý do lưu / chỉnh sửa">
            <input
              className={inputClass}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: kết quả khám ban đầu, bổ sung kết quả..."
              disabled={busy}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {detail.encounter?.status !== "final" && (
              <button
                className={secondaryClass}
                disabled={busy || !reason.trim()}
                onClick={() => void save(false)}
              >
                Lưu bản nháp
              </button>
            )}
            <button
              className={buttonClass}
              disabled={busy || !reason.trim() || !diagnosis.trim()}
              onClick={() => void save(true)}
            >
              {busy
                ? "Đang lưu…"
                : detail.encounter?.status === "final"
                  ? "Xác nhận bản bổ sung"
                  : "Xác nhận và hoàn tất ca"}
            </button>
          </div>
        </section>
      ) : null}
      {detail.encounter?.status === "final" && (
        <>
          <button
            className={secondaryClass}
            onClick={() => printClinic("encounter")}
          >
            In kết quả khám
          </button>
          {printableStyle()}
          <article className="clinic-print-encounter space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-xl font-bold">Phiếu kết quả khám</h3>
            <p>
              <strong>{detail.patient.full_name}</strong> ·{" "}
              {detail.patient.patient_code}
            </p>
            <p>Bác sĩ: {detail.visit.doctor_name}</p>
            <p>
              Ca khám: {dateVN(detail.visit.scheduled_at)} · Hồ sơ phiên bản{" "}
              {detail.encounter.version}
            </p>
            <p className="whitespace-pre-wrap">
              <strong>Triệu chứng:</strong> {detail.encounter.symptoms || "—"}
            </p>
            <p className="whitespace-pre-wrap">
              <strong>Chẩn đoán:</strong> {detail.encounter.diagnosis || "—"}
            </p>
            <p className="whitespace-pre-wrap">
              <strong>Điều trị / hướng dẫn:</strong>{" "}
              {detail.encounter.treatment || "—"}
            </p>
            <p className="whitespace-pre-wrap">
              <strong>Ghi chú:</strong> {detail.encounter.notes || "—"}
            </p>
            <p>
              <strong>Chỉ số khám:</strong>{" "}
              {Object.entries(detail.encounter.vitals)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ") || "Chưa ghi nhận"}
            </p>
            {detail.encounter.follow_up_date && (
              <p>
                <strong>Tái khám:</strong>{" "}
                {new Date(detail.encounter.follow_up_date).toLocaleDateString(
                  "vi-VN",
                  { timeZone: "Asia/Ho_Chi_Minh" },
                )}
              </p>
            )}
            <p className="text-xs text-slate-500">
              Xác nhận lúc {dateVN(detail.encounter.updated_at)}. Phiếu kết quả
              lấy từ hồ sơ được bác sĩ xác nhận.
            </p>
          </article>
        </>
      )}
      {detail.revisions.length > 0 && (
        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer font-semibold">
            Lịch sử chỉnh sửa ({detail.revisions.length})
          </summary>
          <div className="mt-3 space-y-3">
            {detail.revisions.map((r) => (
              <details
                key={r.id}
                className="rounded-lg bg-slate-50 p-3 text-sm"
              >
                <summary>
                  Phiên bản {r.version} · {r.changed_by_name} ·{" "}
                  {dateVN(r.created_at)}
                </summary>
                <p>Lý do: {r.reason}</p>
                <p className="whitespace-pre-wrap">
                  Chẩn đoán: {r.snapshot.diagnosis || "—"}
                  <br />
                  Điều trị: {r.snapshot.treatment || "—"}
                  <br />
                  Ghi chú: {r.snapshot.notes || "—"}
                </p>
              </details>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
