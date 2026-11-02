import React, { useEffect, useState, useRef } from "react";
import { api, request, type ApiAuthUser } from "../api/client";
type Rule = {
  weekday: number;
  startTime: string;
  endTime: string;
  intervalMinutes: number;
};
type Plan = {
  rules: Rule[];
  exceptions: { workDate: string; closed: boolean; reason: string }[];
  version: string;
  isLocked: boolean;
};
type Preview = {
  expectedVersion: string;
  bookedConflicts: number;
  slotsToClose: number;
  slotsToOpen: number;
};
export function ScheduleManager() {
  const [doctors, setDoctors] = useState<ApiAuthUser[]>([]),
    [doctorId, setDoctorId] = useState(""),
    [plan, setPlan] = useState<Plan | null>(null),
    [rules, setRules] = useState<Rule[]>([]),
    [preview, setPreview] = useState<Preview | null>(null);
  const [date, setDate] = useState(""),
    [reason, setReason] = useState(""),
    [closed, setClosed] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const currentDoctor = useRef(doctorId);
  currentDoctor.current = doctorId;
  const [exceptionPreview, setExceptionPreview] = useState<Preview | null>(
      null,
    ),
    [exceptionConfirmed, setExceptionConfirmed] = useState(false);
  useEffect(() => {
    api
      .getAdminUsers("doctor")
      .then(setDoctors)
      .catch((e) => setError(e.message));
  }, []);
  const load = async () => {
    if (!doctorId) return;
    const p = await request<Plan>(`/admin/schedules/${doctorId}`);
    if (doctorId !== currentDoctor.current) return;
    setPlan(p);
    setRules(p.rules);
    setPreview(null);
    setConfirmed(false);
    setExceptionPreview(null);
    setExceptionConfirmed(false);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [doctorId]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không cập nhật được lịch");
    } finally {
      setBusy(false);
    }
  };
  const update = (index: number, patch: Partial<Rule>) => {
    setRules((r) => r.map((x, i) => (i === index ? { ...x, ...patch } : x)));
    setPreview(null);
    setConfirmed(false);
  };
  return (
    <details className="max-w-7xl mx-auto p-4 my-4 rounded-xl border bg-white">
      <summary className="font-bold cursor-pointer">
        Quản lý ca làm việc · ngày nghỉ · sinh lịch
      </summary>
      <div className="space-y-4 mt-4">
        <label className="block">
          Bác sĩ
          <select
            className="block border rounded-lg p-2"
            value={doctorId}
            onChange={(e) => {
              setDoctorId(e.target.value);
              setPlan(null);
            }}
          >
            <option value="">Chọn bác sĩ</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
                {d.isLocked ? " (đang khóa)" : ""}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {plan && (
          <>
            <p>
              Ca đã đặt được bảo vệ. Thay đổi ảnh hưởng lịch đã đặt phải được xử
              lý trước khi áp dụng.
            </p>
            {rules.map((r, i) => (
              <div
                key={i}
                className="flex flex-wrap gap-3 items-end border-b py-2"
              >
                <label>
                  Thứ
                  <select
                    className="block border p-2 rounded-lg"
                    value={r.weekday}
                    onChange={(e) =>
                      update(i, { weekday: Number(e.target.value) })
                    }
                  >
                    {[1, 2, 3, 4, 5].map((d) => (
                      <option key={d} value={d}>
                        Thứ {d + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Từ
                  <input
                    className="block border p-2 rounded-lg"
                    type="time"
                    value={r.startTime}
                    onChange={(e) => update(i, { startTime: e.target.value })}
                  />
                </label>
                <label>
                  Đến
                  <input
                    className="block border p-2 rounded-lg"
                    type="time"
                    value={r.endTime}
                    onChange={(e) => update(i, { endTime: e.target.value })}
                  />
                </label>
                <label>
                  Phút/ca
                  <select
                    className="block border p-2 rounded-lg"
                    value={r.intervalMinutes}
                    onChange={(e) =>
                      update(i, { intervalMinutes: Number(e.target.value) })
                    }
                  >
                    {[10, 15, 20, 30, 60].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="border p-2 rounded-lg"
                  onClick={() => {
                    setRules((x) => x.filter((_, j) => i !== j));
                    setPreview(null);
                  }}
                >
                  Bỏ khung giờ
                </button>
              </div>
            ))}
            <button
              className="border rounded-lg p-2"
              onClick={() => {
                setRules((r) => [
                  ...r,
                  {
                    weekday: 1,
                    startTime: "08:00",
                    endTime: "11:30",
                    intervalMinutes: 15,
                  },
                ]);
                setPreview(null);
              }}
            >
              Thêm khung giờ
            </button>
            <button
              className="border rounded-lg p-2 ml-3"
              disabled={busy}
              onClick={() =>
                void action(async () =>
                  setPreview(
                    await request<Preview>(
                      `/admin/schedules/${doctorId}/preview`,
                      { method: "POST", body: JSON.stringify({ rules }) },
                    ),
                  ),
                )
              }
            >
              Xem trước ảnh hưởng
            </button>
            {preview && (
              <div className="bg-amber-50 rounded-xl p-3 space-y-3">
                <p>
                  Mở {preview.slotsToOpen} ca; đóng {preview.slotsToClose} ca
                  trống; {preview.bookedConflicts} ca đã đặt bị ảnh hưởng.
                </p>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  Tôi đã kiểm tra ảnh hưởng và xác nhận thay đổi
                </label>
                <button
                  className="border rounded-lg p-2"
                  disabled={busy || !confirmed || preview.bookedConflicts > 0}
                  onClick={() =>
                    void action(async () => {
                      await request(`/admin/schedules/${doctorId}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          rules,
                          confirm: true,
                          expectedVersion: preview.expectedVersion,
                        }),
                      });
                      await load();
                    })
                  }
                >
                  Áp dụng lịch
                </button>
              </div>
            )}
            <div className="border-t pt-3 space-y-3">
              <h3 className="font-semibold">Ngoại lệ theo ngày</h3>
              <label className="block">
                Ngày
                <input
                  className="block border p-2 rounded-lg"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setExceptionPreview(null);
                    setExceptionConfirmed(false);
                  }}
                />
              </label>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={closed}
                  onChange={(e) => {
                    setClosed(e.target.checked);
                    setExceptionPreview(null);
                    setExceptionConfirmed(false);
                  }}
                />
                Đóng toàn bộ ca trống trong ngày
              </label>
              <label className="block">
                Lý do
                <input
                  className="block border p-2 rounded-lg w-full"
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                className="border rounded-lg p-2"
                disabled={busy || !date || !reason.trim()}
                onClick={() =>
                  void action(async () => {
                    setExceptionPreview(
                      await request<Preview>(
                        `/admin/schedules/${doctorId}/exceptions/preview`,
                        {
                          method: "POST",
                          body: JSON.stringify({
                            workDate: date,
                            closed,
                            reason,
                          }),
                        },
                      ),
                    );
                    setExceptionConfirmed(false);
                  })
                }
              >
                Xem trước ngoại lệ
              </button>
              {exceptionPreview && (
                <div className="rounded-lg bg-amber-50 p-3 space-y-2">
                  <p>
                    Đóng {exceptionPreview.slotsToClose} ca trống;{" "}
                    {exceptionPreview.bookedConflicts} ca đã đặt bị ảnh hưởng.
                  </p>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={exceptionConfirmed}
                      onChange={(e) => setExceptionConfirmed(e.target.checked)}
                    />
                    Tôi đã kiểm tra ngày và ảnh hưởng
                  </label>
                  <button
                    className="border rounded-lg p-2"
                    disabled={
                      busy ||
                      !exceptionConfirmed ||
                      exceptionPreview.bookedConflicts > 0
                    }
                    onClick={() =>
                      void action(async () => {
                        await request(
                          `/admin/schedules/${doctorId}/exceptions`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              workDate: date,
                              closed,
                              reason,
                              confirm: true,
                              expectedVersion: exceptionPreview.expectedVersion,
                            }),
                          },
                        );
                        await load();
                      })
                    }
                  >
                    Xác nhận ngoại lệ
                  </button>
                </div>
              )}
              {plan.exceptions.map((e) => (
                <p key={e.workDate}>
                  {e.workDate} · {e.closed ? "Đóng" : "Mở theo lịch thường"} ·{" "}
                  {e.reason}
                </p>
              ))}
            </div>
            <button
              className="border rounded-lg p-2"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await request(`/admin/schedules/${doctorId}/generate`, {
                    method: "POST",
                  });
                  await load();
                })
              }
            >
              Bổ sung ca cho 30 ngày tới
            </button>
          </>
        )}
      </div>
    </details>
  );
}
