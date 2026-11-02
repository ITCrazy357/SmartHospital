import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Calendar,
  Clock,
  FileText,
  CreditCard,
  Wallet,
  Building2,
  ArrowLeft,
} from "lucide-react";
import { Doctor } from "../types";
import { api } from "../api/client";
import { useToast } from "../contexts/ToastContext";
import type { ApiAppointmentSlot, ApiSlotSuggestionItem } from "../api/client";
import { AiSlotSuggestionPanel } from "./booking/AiSlotSuggestionPanel";
import {
  formatSlotDateLabel,
  formatSlotTime,
  getAvailableDates,
  groupSlotsByDate,
  isSlotTimeInFuture,
} from "../utils/appointmentSlots";
import { useBookingPolicy } from "../contexts/BookingPolicyContext";

const STEP_LABELS = [
  { id: 1, name: "Chọn ngày" },
  { id: 2, name: "Chọn giờ" },
  { id: 3, name: "Triệu chứng" },
  { id: 4, name: "Thanh toán" },
];

interface BookingFlowProps {
  doctor: Doctor;
  onComplete: () => void;
  onPaymentSuccess: () => void;
  onCancel: () => void;
}

/** Phân slot theo ca: sáng < 12:00, chiều >= 12:00 */
function groupSlotsBySession(slots: ApiAppointmentSlot[]) {
  const morning = slots.filter((s) => {
    const h = new Date(s.slotTime).getHours();
    return h < 12;
  });
  const afternoon = slots.filter((s) => {
    const h = new Date(s.slotTime).getHours();
    return h >= 12;
  });
  return { morning, afternoon };
}

export const BookingFlow: React.FC<BookingFlowProps> = ({
  doctor,
  onComplete,
  onPaymentSuccess,
  onCancel,
}) => {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<ApiAppointmentSlot | null>(
    null,
  );
  const [symptoms, setSymptoms] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [payosTabOpened, setPayosTabOpened] = useState(false);
  const [pendingAppointmentId, setPendingAppointmentId] = useState<
    string | null
  >(null);
  const [slots, setSlots] = useState<ApiAppointmentSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [paymentCheckError, setPaymentCheckError] = useState<string | null>(
    null,
  );
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const { depositAmount, consultationFee } = useBookingPolicy();
  const remainingAmount = Math.max(0, consultationFee - depositAmount);

  useEffect(() => {
    let cancelled = false;
    setLoadingSlots(true);
    setSelectedDate(null);
    setSelectedSlot(null);
    const from = new Date().toISOString().slice(0, 10);
    api
      .getDoctorSlots(doctor.id, from)
      .then((list) => {
        if (cancelled) return;
        setSlots(list);
        if (list.length === 0) return;
        const firstFuture = list.find((s) => isSlotTimeInFuture(s.slotTime));
        if (firstFuture) {
          setSelectedDate(firstFuture.slotTime.slice(0, 10));
        }
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doctor.id]);

  const slotsByDate = useMemo(() => groupSlotsByDate(slots), [slots]);

  /** Ngày còn ít nhất một khung giờ có thể đặt (chưa qua giờ). */
  const availableDates = useMemo(
    () => getAvailableDates(slotsByDate),
    [slotsByDate],
  );

  /** Mọi slot trống trong ngày đang chọn (kể cả đã qua — hiển thị disabled). */
  const timeSlotsForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return slotsByDate[selectedDate] ?? [];
  }, [selectedDate, slotsByDate]);

  const hasBookableSlotOnSelectedDate = useMemo(
    () => timeSlotsForSelectedDate.some((s) => isSlotTimeInFuture(s.slotTime)),
    [timeSlotsForSelectedDate],
  );

  /** Đồng hồ trôi / API cập nhật — bỏ chọn slot nếu khung giờ đã qua. */
  useEffect(() => {
    if (!selectedSlot) return;
    if (!isSlotTimeInFuture(selectedSlot.slotTime)) {
      setSelectedSlot(null);
    }
  }, [selectedSlot, slots]);

  /** Ngày đang chọn không còn slot tương lai — chọn lại ngày đầu hoặc xóa. */
  useEffect(() => {
    if (availableDates.length === 0) {
      setSelectedSlot(null);
      setSelectedDate(null);
      return;
    }
    if (!selectedDate) return;
    if (!availableDates.includes(selectedDate)) {
      setSelectedDate(availableDates[0]);
      setSelectedSlot(null);
    }
  }, [selectedDate, availableDates]);

  const getStepStatus = (stepId: number) => {
    if (confirmed && stepId <= 4) return "completed";
    if (stepId < step) return "completed";
    if (stepId === step) return "active";
    return "pending";
  };

  const renderStepper = () => (
    <div className="flex items-center justify-between mb-10">
      {STEP_LABELS.map((s, i) => {
        const status = getStepStatus(s.id);
        return (
          <React.Fragment key={s.id}>
            <div className="flex flex-col items-center gap-2">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-all ${
                  status === "completed"
                    ? "bg-secondary border-secondary text-white"
                    : status === "active"
                      ? "bg-primary border-primary text-white shadow-lg shadow-primary/20"
                      : "bg-white border-slate-200 text-slate-400"
                }`}
              >
                {status === "completed" ? <Check className="w-5 h-5" /> : s.id}
              </div>
              <span
                className={`text-xs font-bold hidden sm:block ${status === "active" ? "text-primary" : "text-slate-400"}`}
              >
                {s.name}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 sm:mx-4 min-w-[8px] ${status === "completed" ? "bg-secondary" : "bg-slate-200"}`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  const appointmentRecap = (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col sm:flex-row gap-4 items-center">
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-slate-100 shrink-0">
        <img
          src={doctor.image}
          alt={doctor.name}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex-1 text-center sm:text-left">
        <h3 className="font-bold text-slate-900">{doctor.name}</h3>
        <p className="text-sm text-primary font-medium">{doctor.specialty}</p>
        {(selectedDate || selectedSlot) && (
          <div className="flex flex-wrap justify-center sm:justify-start gap-3 mt-2 text-xs text-slate-500">
            {selectedDate && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />{" "}
                {formatSlotDateLabel(selectedDate).full}
              </span>
            )}
            {selectedSlot && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />{" "}
                {formatSlotTime(selectedSlot.slotTime)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="text-center sm:text-right">
        <span className="text-xs text-slate-400 block">Phí khám</span>
        <span className="text-xl font-black text-slate-900">
          {consultationFee.toLocaleString("vi-VN")}đ
        </span>
      </div>
    </div>
  );

  if (confirmed) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <div className="text-center space-y-6 py-8">
          <div className="w-20 h-20 sm:w-24 sm:h-24 bg-secondary/20 rounded-full flex items-center justify-center mx-auto text-secondary">
            <Check className="w-10 h-10 sm:w-12 sm:h-12" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Đặt lịch thành công
            </h2>
            <p className="text-slate-500 text-sm sm:text-base">
              Cuộc hẹn của bạn đã được xác nhận. Bạn có thể xem lại trong mục
              Lịch khám.
            </p>
          </div>

          <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6 text-left max-w-md mx-auto">
            <div className="flex items-center gap-4 pb-6 border-b border-slate-100">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden bg-slate-100 shrink-0">
                <img
                  src={doctor.image}
                  alt={doctor.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">{doctor.name}</h3>
                <p className="text-xs text-primary font-bold">
                  {doctor.specialty}
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 font-medium">Ngày & giờ</span>
                <span className="text-slate-900 font-bold">
                  {selectedDate ? formatSlotDateLabel(selectedDate).full : "—"},{" "}
                  {selectedSlot ? formatSlotTime(selectedSlot.slotTime) : "—"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 font-medium">Địa điểm</span>
                <span className="text-slate-900 font-bold">
                  {doctor.hospital}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 font-medium">Tiền đặt cọc</span>
                <span className="font-bold text-primary">
                  {depositAmount.toLocaleString("vi-VN")}đ
                </span>
              </div>
              <div className="flex justify-between text-sm pt-4 border-t border-slate-100">
                <span className="text-slate-700 font-bold">
                  Thanh toán còn lại khi khám
                </span>
                <span className="text-slate-900 font-bold">
                  {remainingAmount.toLocaleString("vi-VN")}đ
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={onComplete}
              className="px-6 py-4 sm:px-8 sm:py-4 bg-primary text-white rounded-2xl font-bold text-base hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
            >
              Xem lịch khám
            </button>
            <button className="px-6 py-4 sm:px-8 sm:py-4 bg-white text-slate-700 border border-slate-200 rounded-2xl font-bold text-base hover:bg-slate-50 transition-all flex items-center justify-center gap-2">
              <Calendar className="w-5 h-5" />
              Thêm vào lịch
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
      {renderStepper()}

      {/* Step 1: Chọn ngày */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <button
              onClick={onCancel}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              aria-label="Quay lại"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              Chọn ngày khám
            </h2>
          </div>
          {appointmentRecap}

          {/* AI gợi ý slot — click 1 thẻ → tự set ngày/giờ và nhảy step 3 */}
          <AiSlotSuggestionPanel
            doctorId={doctor.id}
            onPick={(s: ApiSlotSuggestionItem) => {
              const matched = slots.find((x) => x.id === s.slotId);
              if (!matched) {
                toast.error("Slot này vừa được đặt. Hãy thử slot khác.");
                return;
              }
              if (!isSlotTimeInFuture(matched.slotTime)) {
                toast.error(
                  "Khung giờ này đã qua. Vui lòng gợi ý lại hoặc chọn giờ khác.",
                );
                return;
              }
              const dateKey = matched.slotTime.slice(0, 10);
              setSelectedDate(dateKey);
              setSelectedSlot(matched);
              setStep(3);
            }}
          />

          <div className="bg-white p-6 rounded-2xl border border-slate-200">
            <p className="text-sm font-bold text-slate-700 mb-4">
              Hoặc chọn ngày thủ công
            </p>
            {loadingSlots ? (
              <p className="text-sm text-slate-500">Đang tải lịch trống...</p>
            ) : availableDates.length === 0 ? (
              <p className="text-sm text-slate-500">
                Chưa có slot trống cho bác sĩ này.
              </p>
            ) : (
              <div className="grid grid-cols-5 gap-3">
                {availableDates.map((d) => {
                  const info = formatSlotDateLabel(d);
                  return (
                    <button
                      key={d}
                      onClick={() => {
                        setSelectedDate(d);
                        setSelectedSlot(null);
                      }}
                      className={`py-4 rounded-2xl border-2 flex flex-col items-center gap-1 transition-all ${
                        selectedDate === d
                          ? "bg-primary border-primary text-white shadow-lg shadow-primary/20"
                          : "bg-white border-slate-100 text-slate-600 hover:border-primary/50"
                      }`}
                    >
                      <span className="text-[10px] font-bold uppercase">
                        {info.label}
                      </span>
                      <span className="text-lg font-black">{info.short}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={
              !selectedDate || availableDates.length === 0 || loadingSlots
            }
            className="w-full py-4 sm:py-5 bg-primary text-white rounded-2xl font-bold text-base sm:text-lg shadow-xl shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Tiếp: Chọn giờ <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Step 2: Chọn khung giờ */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setStep(1)}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              Chọn khung giờ
            </h2>
          </div>
          {appointmentRecap}
          <div className="bg-white p-6 rounded-2xl border border-slate-200">
            <p className="text-sm font-bold text-slate-700 mb-1">
              Khung giờ trống
            </p>
            <p className="text-xs text-slate-500 mb-4">
              Ô mờ là giờ đã qua (không thể đặt). Chỉ có thể chọn khung còn
              trong tương lai.
            </p>
            {loadingSlots ? (
              <p className="text-sm text-slate-500">Đang tải slot...</p>
            ) : timeSlotsForSelectedDate.length === 0 ? (
              <p className="text-sm text-slate-500">
                Không có slot trống cho ngày này.
              </p>
            ) : (
              <>
                {!hasBookableSlotOnSelectedDate ? (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
                    Trong ngày này không còn khung giờ nào có thể đặt. Vui lòng
                    quay lại bước trước để chọn ngày khác.
                  </p>
                ) : null}
                {(() => {
                  const { morning, afternoon } = groupSlotsBySession(
                    timeSlotsForSelectedDate,
                  );
                  const renderGroup = (
                    label: string,
                    group: ApiAppointmentSlot[],
                  ) =>
                    group.length === 0 ? null : (
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                          {label}
                        </p>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {group.map((s) => {
                            const past = !isSlotTimeInFuture(s.slotTime);
                            const selected = selectedSlot?.id === s.id;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                disabled={past}
                                title={
                                  past
                                    ? "Khung giờ đã qua — không thể đặt"
                                    : undefined
                                }
                                onClick={() => {
                                  if (!past) setSelectedSlot(s);
                                }}
                                className={`py-3 rounded-xl border-2 text-sm font-bold transition-all ${
                                  past
                                    ? "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400 opacity-70"
                                    : selected
                                      ? "bg-primary/10 border-primary text-primary"
                                      : "bg-white border-slate-100 text-slate-600 hover:border-primary/50"
                                }`}
                              >
                                {formatSlotTime(s.slotTime)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  return (
                    <div className="space-y-4">
                      {renderGroup("☀️ Buổi sáng", morning)}
                      {renderGroup("🌤 Buổi chiều", afternoon)}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
          <button
            onClick={() => setStep(3)}
            disabled={
              !selectedSlot || !isSlotTimeInFuture(selectedSlot.slotTime)
            }
            className="w-full py-4 sm:py-5 bg-primary text-white rounded-2xl font-bold text-base sm:text-lg shadow-xl shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Tiếp: Triệu chứng <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setStep(2)}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              Triệu chứng & lý do khám
            </h2>
          </div>
          {appointmentRecap}
          <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                Triệu chứng / Lý do khám{" "}
                <span className="text-slate-400 font-normal">(tùy chọn)</span>
              </label>
              <div className="relative">
                <FileText className="absolute left-4 top-4 w-5 h-5 text-slate-400" />
                <textarea
                  rows={3}
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                  placeholder="Mô tả triệu chứng hoặc lý do đặt lịch..."
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-primary transition-all resize-none"
                />
              </div>
            </div>
          </div>

          {/* Banner cảnh báo điều kiện đặt lịch */}
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 sm:p-8 space-y-5">
            <div className="space-y-3">
              <h3 className="text-base font-bold text-red-900 flex items-center gap-2">
                <span className="text-xl">⚠️</span>
                Điều kiện đặt lịch khám
              </h3>
              <div className="space-y-3 text-sm text-red-800">
                <div className="flex gap-3 items-start">
                  <span className="font-bold text-lg shrink-0">✓</span>
                  <span>
                    <strong>Tiền đặt cọc:</strong>{" "}
                    <span className="text-lg font-black text-red-900">
                      {depositAmount.toLocaleString("vi-VN")}đ
                    </span>{" "}
                    (giữ chỗ khám)
                  </span>
                </div>

                <div className="flex gap-3 items-start">
                  <span className="font-bold text-lg shrink-0">✗</span>
                  <span>
                    <strong>Không hoàn cọc</strong> sau khi xác nhận đặt lịch
                  </span>
                </div>
                <div className="bg-red-100 rounded-lg p-3 mt-2 border border-red-300">
                  <p className="font-bold text-red-900 mb-1">
                    ❓ Trường hợp ngoại lệ:
                  </p>
                  <p>
                    Nếu không thể đến bệnh viện, vui lòng{" "}
                    <strong>đến trực tiếp bệnh viện </strong> để báo cáo tình
                    trạng, đưa minh chứng và xin xử lý ngoại lệ.
                  </p>
                </div>
              </div>
            </div>

            {/* Checkbox xác nhận */}
            <div className="flex items-start gap-3 pt-3 border-t border-red-200">
              <input
                type="checkbox"
                id="agreeTerms"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="w-5 h-5 rounded border-2 border-red-300 accent-red-600 cursor-pointer mt-0.5 shrink-0"
              />
              <label
                htmlFor="agreeTerms"
                className="text-sm font-bold text-red-900 cursor-pointer flex-1"
              >
                Tôi đã đọc kỹ và đồng ý với các điều kiện trên
              </label>
            </div>
          </div>

          <button
            onClick={() => {
              if (agreedToTerms) {
                setStep(4);
              } else {
                toast.error(
                  "Vui lòng xác nhận đã đọc kỹ điều kiện trước khi tiếp tục",
                );
              }
            }}
            disabled={!agreedToTerms}
            className={`w-full py-4 sm:py-5 rounded-2xl font-bold text-base sm:text-lg shadow-xl transition-all flex items-center justify-center gap-2 ${
              agreedToTerms
                ? "bg-primary text-white shadow-primary/20 hover:bg-primary/90"
                : "bg-slate-200 text-slate-400 cursor-not-allowed opacity-70"
            }`}
          >
            {agreedToTerms ? (
              <>
                Tiếp: Thanh toán đặt cọc <ChevronRight className="w-5 h-5" />
              </>
            ) : (
              <>✓ Tôi đã đọc kỹ điều kiện</>
            )}
          </button>
        </div>
      )}

      {/* Step 4: Thanh toán đặt cọc */}
      {step === 4 && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setStep(3)}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              Thanh toán đặt cọc
            </h2>
          </div>
          {appointmentRecap}
          {payosTabOpened && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-4">
              <p className="text-sm text-amber-800 font-medium">
                Trang thanh toán (mã QR) đã mở trong tab mới. Sau khi thanh toán
                xong, bạn sẽ được chuyển về trang xác nhận.
              </p>
              <p className="text-sm text-amber-700">
                Nếu bạn đã thanh toán xong, bấm nút bên dưới để kiểm tra và xem
                lịch đã đặt.
              </p>
              {paymentCheckError && (
                <p className="text-sm text-red-600 bg-red-50 p-3 rounded-xl">
                  {paymentCheckError}
                </p>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (!pendingAppointmentId) return;
                  setPaymentCheckError(null);
                  setCheckingPayment(true);
                  try {
                    const list = await api.getMyAppointments();
                    const apt = list.find((a) => a.id === pendingAppointmentId);
                    if (apt?.status === "confirmed") {
                      onPaymentSuccess();
                      return;
                    }
                    setPaymentCheckError(
                      "Chưa ghi nhận thanh toán. Vui lòng hoàn tất thanh toán trên trang PayOS hoặc thử lại sau vài phút.",
                    );
                  } catch {
                    setPaymentCheckError(
                      "Không kiểm tra được trạng thái. Vui lòng thử lại.",
                    );
                  } finally {
                    setCheckingPayment(false);
                  }
                }}
                disabled={!pendingAppointmentId || checkingPayment}
                className="w-full py-3 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {checkingPayment ? "Đang kiểm tra…" : "Tôi đã thanh toán xong"}
              </button>
            </div>
          )}
          <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 space-y-6">
            <div className="flex justify-between items-center p-4 bg-primary/5 rounded-2xl">
              <span className="text-slate-700 font-bold">Đặt cọc giữ chỗ</span>
              <span className="text-xl font-black text-primary">
                {depositAmount.toLocaleString("vi-VN")}đ
              </span>
            </div>
            {remainingAmount > 0 && (
              <p className="text-sm text-slate-500">
                Phần còn lại{" "}
                <strong>{remainingAmount.toLocaleString("vi-VN")}đ</strong>{" "}
                thanh toán khi khám xong.
              </p>
            )}
            <div>
              <p className="text-sm font-bold text-slate-700 mb-4">
                Phương thức thanh toán
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  {
                    id: "card",
                    name: "Chuyển khoản QR (PayOS)",
                    icon: CreditCard,
                    supported: true,
                  },
                  {
                    id: "ewallet",
                    name: "Ví điện tử",
                    icon: Wallet,
                    supported: false,
                  },
                  {
                    id: "hospital",
                    name: "Thanh toán tại bệnh viện",
                    icon: Building2,
                    supported: false,
                  },
                ].map((method, i) => (
                  <div
                    key={method.id}
                    className={`relative p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${
                      !method.supported
                        ? "border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed"
                        : i === 0
                          ? "border-primary bg-primary/5"
                          : "border-slate-100 bg-white hover:border-primary/30"
                    }`}
                  >
                    {!method.supported && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wide bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full whitespace-nowrap">
                        Sắp ra mắt
                      </span>
                    )}
                    <method.icon
                      className={`w-6 h-6 ${!method.supported ? "text-slate-300" : i === 0 ? "text-primary" : "text-slate-400"}`}
                    />
                    <span
                      className={`text-xs font-bold text-center ${!method.supported ? "text-slate-400" : i === 0 ? "text-primary" : "text-slate-600"}`}
                    >
                      {method.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {bookingError && (
              <p className="text-sm text-red-600 bg-red-50 p-3 rounded-xl">
                {bookingError}
              </p>
            )}
            <button
              onClick={async () => {
                if (!selectedSlot) return;
                setBookingError(null);
                setBookingLoading(true);
                try {
                  const origin = window.location.origin;
                  const path = window.location.pathname || "/";
                  const returnUrl = `${origin}${path}?view=booking-success`;
                  const cancelUrl = `${origin}${path}?view=booking&payment=cancel`;
                  const res = await api.createAppointment({
                    slotId: selectedSlot.id,
                    symptoms: symptoms.trim() || undefined,
                    returnUrl,
                    cancelUrl,
                  });
                  if (res.checkoutUrl) {
                    window.location.assign(
                      `?view=booking-success&appointmentId=${encodeURIComponent(res.appointment.id)}`,
                    );
                    setPayosTabOpened(true);
                    setPendingAppointmentId(res.appointment.id);
                    setPaymentCheckError(null);
                    toast.success("Đã giữ lịch; vui lòng tiếp tục thanh toán.");
                    return;
                  }
                  setBookingError(
                    "Không tạo được link thanh toán. Vui lòng thử lại.",
                  );
                } catch (e: unknown) {
                  const msg =
                    e && typeof e === "object" && "message" in e
                      ? String((e as { message: unknown }).message)
                      : "Không đặt lịch được. Vui lòng thử lại.";
                  setBookingError(msg);
                } finally {
                  setBookingLoading(false);
                }
              }}
              disabled={!selectedSlot || bookingLoading}
              className="w-full py-4 sm:py-5 bg-primary text-white rounded-2xl font-bold text-base sm:text-lg shadow-xl shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {bookingLoading
                ? "Đang tạo link thanh toán…"
                : "Xác nhận đặt cọc"}{" "}
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
