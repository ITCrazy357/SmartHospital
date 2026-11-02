import React, { useEffect, useState } from "react";
import {
  api,
  type ApiAppointment,
  type ApiAppointmentSlot,
} from "../api/client";

export function PatientAppointmentTools() {
  const [page, setPage] = useState(1),
    [list, setList] = useState<ApiAppointment[]>([]),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<ApiAppointment | null>(null),
    [slots, setSlots] = useState<ApiAppointmentSlot[]>([]),
    [slotId, setSlotId] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api
      .getMyAppointments(page)
      .then(setList)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [page]);
  const select = async (a: ApiAppointment) => {
    setSelected(a);
    setSlotId("");
    setReason("");
    setError("");
    try {
      setSlots(
        (await api.getDoctorSlots(a.doctorId, new Date().toISOString())).filter(
          (s) => new Date(s.slotTime).getTime() > Date.now(),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được ca");
    }
  };
  const move = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.rescheduleAppointment(selected.id, slotId, reason);
      setSelected(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đổi được lịch");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border bg-white p-4 space-y-3">
      <h2 className="font-bold">Tiếp tục thanh toán / đổi lịch</h2>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {list.map((a) => (
        <div
          key={a.id}
          className="flex flex-wrap gap-3 items-center border-b py-2"
        >
          <span className="flex-1">
            {a.doctor?.fullName} ·{" "}
            {a.slot ? new Date(a.slot.slotTime).toLocaleString("vi-VN") : ""} ·{" "}
            {a.status}
          </span>
          <a
            className="text-primary underline"
            href={`?view=booking-success&appointmentId=${a.id}`}
          >
            Trạng thái thanh toán
          </a>
          {a.status === "confirmed" &&
            a.slot &&
            new Date(a.slot.slotTime).getTime() > Date.now() && (
              <button
                className="border rounded-lg p-2"
                onClick={() => void select(a)}
              >
                Đổi lịch
              </button>
            )}
        </div>
      ))}
      <div className="flex items-center gap-4">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Trang trước
        </button>
        <span>Trang {page}</span>
        <button
          disabled={list.length < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          Trang sau
        </button>
      </div>
      {selected && (
        <div className="rounded-xl bg-slate-50 p-3 space-y-3">
          <p className="font-medium">
            Chọn ca mới của {selected.doctor?.fullName}. Tiền cọc giữ nguyên.
          </p>
          <label className="block">
            Ca mới
            <select
              className="block border rounded-lg p-2 w-full"
              value={slotId}
              onChange={(e) => setSlotId(e.target.value)}
            >
              <option value="">Chọn giờ</option>
              {slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {new Date(s.slotTime).toLocaleString("vi-VN")}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Lý do
            <input
              className="block border rounded-lg p-2 w-full"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex gap-3">
            <button
              className="border rounded-lg p-2"
              disabled={busy || !slotId || !reason.trim()}
              onClick={() => void move()}
            >
              Xác nhận đổi lịch
            </button>
            <button onClick={() => setSelected(null)}>Đóng</button>
          </div>
        </div>
      )}
    </section>
  );
}
