import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { downloadAppointmentCalendar } from "../utils/calendar";

export interface BookingStatus {
  id: string;
  status: string;
  doctorId: string;
  doctorName?: string;
  slotTime?: string;
  paymentStatus: string | null;
  checkoutUrl?: string | null;
  expiresAt?: string | null;
  amount: number | null;
  reconciliationStatus?: string;
}

export function BookingResult({ onDashboard }: { onDashboard: () => void }) {
  const id = new URLSearchParams(window.location.search).get("appointmentId");
  const [status, setStatus] = useState<BookingStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const load = async () => {
    if (!id) return;
    setBusy(true);
    try {
      setStatus(await api.getAppointmentStatus(id));
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không kiểm tra được lịch khám",
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [id]);
  useEffect(() => {
    if (!id || !status || status.status !== "pending") return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [id, status?.status]);
  const success =
    status &&
    ["confirmed", "completed"].includes(status.status) &&
    status.paymentStatus === "paid";
  const seconds = status?.expiresAt
    ? Math.max(
        0,
        Math.ceil((new Date(status.expiresAt).getTime() - now) / 1000),
      )
    : 0;
  return (
    <section className="max-w-xl mx-auto p-5 my-8 space-y-4 rounded-2xl border border-slate-200 bg-white">
      <h1 className="text-xl font-bold">
        {success
          ? "Lịch khám đã được xác nhận"
          : status?.status === "cancelled"
            ? "Lịch khám đã hủy"
            : "Kiểm tra thanh toán"}
      </h1>
      {!id && (
        <p>
          Thiếu mã lịch khám. Vào lịch của bạn để xem trạng thái đã ghi nhận.
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {status && (
        <>
          <p>
            {status.doctorName} ·{" "}
            {status.slotTime
              ? new Date(status.slotTime).toLocaleString("vi-VN")
              : ""}
          </p>
          <p>
            Trạng thái:{" "}
            {success
              ? "Đã cọc"
              : status.paymentStatus === "paid"
                ? "Đã nhận tiền, chờ xử lý lịch"
                : status.status === "pending"
                  ? "Chờ thanh toán"
                  : "Chưa xác nhận lịch"}
          </p>
          {status.reconciliationStatus === "needs_review" && (
            <p className="rounded-lg bg-amber-50 p-3">
              Giao dịch cần phòng khám đối soát. Không thanh toán lại; liên hệ
              lễ tân kèm mã {status.id}.
            </p>
          )}
          {status.status === "pending" && (
            <p>
              Thời gian giữ chỗ còn: {Math.floor(seconds / 60)}:
              {String(seconds % 60).padStart(2, "0")}. Trạng thái cuối được xác
              nhận từ máy chủ.
            </p>
          )}
          {status.status === "pending" && status.checkoutUrl && seconds > 0 && (
            <a
              className="block rounded-lg bg-primary p-3 text-white text-center"
              href={status.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Tiếp tục thanh toán
            </a>
          )}
          {status.status === "pending" &&
            !status.checkoutUrl &&
            seconds > 0 && (
              <button
                className="border rounded-lg p-3"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.resumeAppointmentCheckout(status.id);
                    await load();
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Chưa mở được thanh toán",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Thử mở lại thanh toán
              </button>
            )}
          {success && status.slotTime && (
            <button
              className="border rounded-lg p-3"
              onClick={() =>
                downloadAppointmentCalendar(
                  status.id,
                  status.slotTime!,
                  status.doctorName || "Bác sĩ",
                )
              }
            >
              Thêm vào lịch
            </button>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          className="border rounded-lg p-3"
          onClick={() => void load()}
          disabled={busy || !id}
        >
          {busy ? "Đang kiểm tra…" : "Kiểm tra lại"}
        </button>
        <button className="border rounded-lg p-3" onClick={onDashboard}>
          Xem lịch của tôi
        </button>
      </div>
    </section>
  );
}
