import React, { useState, useEffect, useMemo } from "react";
import {
  Star,
  MapPin,
  Award,
  MessageSquare,
  ThumbsUp,
  ChevronRight,
  GraduationCap,
  Clock,
  Briefcase,
} from "lucide-react";
import { Doctor } from "../types";
import { api } from "../api/client";
import type { ApiAppointmentSlot } from "../api/client";
import { mapDoctor } from "../api/mappers";
import { AdSlotSection } from "./AdSlotSection";
import {
  formatSlotDateLabel,
  formatSlotTime,
  getAvailableDates,
  groupSlotsByDate,
  isSlotTimeInFuture,
} from "../utils/appointmentSlots";

interface DoctorProfileProps {
  doctor: Doctor;
  onBook: (doctor: Doctor) => void;
}

function experienceLabel(years: number): string | null {
  if (years > 0) return `${years} năm kinh nghiệm`;
  return null;
}

export const DoctorProfile: React.FC<DoctorProfileProps> = ({
  doctor: initialDoctor,
  onBook,
}) => {
  const [activeTab, setActiveTab] = useState("Overview");
  const [doctor, setDoctor] = useState<Doctor>(initialDoctor);
  const [slots, setSlots] = useState<ApiAppointmentSlot[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingDetail(true);
    const from = new Date().toISOString().slice(0, 10);
    Promise.all([
      api
        .getDoctor(initialDoctor.id)
        .then((d) => (cancelled ? null : mapDoctor(d))),
      api
        .getDoctorSlots(initialDoctor.id, from)
        .then((list) => (cancelled ? [] : list)),
    ])
      .then(([doc, list]) => {
        if (cancelled) return;
        if (doc) setDoctor(doc);
        setSlots(list ?? []);
        const byDate = groupSlotsByDate(list ?? []);
        const dates = getAvailableDates(byDate);
        if (dates.length > 0) setSelectedDate(dates[0]);
        else setSelectedDate(null);
      })
      .catch(() => {
        if (!cancelled) setDoctor(initialDoctor);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialDoctor.id, initialDoctor]);

  const slotsByDate = useMemo(() => groupSlotsByDate(slots), [slots]);
  const availableDates = useMemo(
    () => getAvailableDates(slotsByDate),
    [slotsByDate],
  );
  const activeDate =
    selectedDate && availableDates.includes(selectedDate)
      ? selectedDate
      : (availableDates[0] ?? null);
  const timeSlotsForDate = activeDate ? (slotsByDate[activeDate] ?? []) : [];

  const specialtyHeadline =
    [doctor.specialty, doctor.degree].filter(Boolean).join(" • ") || "Bác sĩ";
  const expText = experienceLabel(doctor.experience);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Main Content */}
        <div className="flex-1 space-y-8">
          {/* Doctor header card */}
          {loadingDetail ? (
            <div className="bg-white rounded-[2rem] border border-slate-200 p-8 shadow-sm">
              <div className="flex flex-col md:flex-row gap-8">
                <div className="relative w-48 h-48 rounded-[2rem] bg-slate-200 shrink-0 mx-auto md:mx-0 overflow-hidden">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                </div>
                <div className="flex-1 space-y-4 py-2">
                  <div className="relative h-8 w-2/3 rounded-xl bg-slate-200 overflow-hidden">
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                  </div>
                  <div className="relative h-5 w-1/3 rounded-lg bg-slate-200 overflow-hidden">
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                  </div>
                  <div className="flex gap-4 pt-2">
                    {[80, 60, 72].map((w, i) => (
                      <div
                        key={i}
                        className="relative h-4 rounded-lg bg-slate-200 overflow-hidden"
                        style={{ width: `${w}px` }}
                      >
                        <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-[2rem] border border-slate-200 p-8 shadow-sm">
              <div className="flex flex-col md:flex-row gap-8">
                <div className="relative shrink-0 mx-auto md:mx-0">
                  <div className="w-48 h-48 rounded-[2rem] overflow-hidden bg-slate-100">
                    <img
                      src={doctor.image}
                      alt={doctor.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-green-500 border-4 border-white rounded-full" />
                </div>

                <div className="flex-1 text-center md:text-left space-y-4">
                  <div>
                    <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                      {doctor.name}
                    </h1>
                    <p className="text-primary font-bold text-lg">
                      {specialtyHeadline}
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center md:justify-start gap-6">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                        <span className="font-bold text-slate-900">
                          {doctor.reviewsCount > 0
                            ? doctor.rating
                            : "Chưa có đánh giá"}
                        </span>
                      </div>
                      {doctor.reviewsCount > 0 && (
                        <span className="text-sm text-slate-500">
                          ({doctor.reviewsCount} đánh giá)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-slate-500">
                      <MapPin className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">
                        {doctor.location}
                      </span>
                    </div>
                    {expText ? (
                      <div className="flex items-center gap-2 text-slate-500">
                        <Award className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium">{expText}</span>
                      </div>
                    ) : null}
                    {doctor.university ? (
                      <div className="flex items-center gap-2 text-slate-500">
                        <GraduationCap className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-sm font-medium">
                          {doctor.university}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Quảng cáo — chỉ render khi có ad active, không chiếm chỗ nếu không có */}
          {!loadingDetail && (
            <AdSlotSection placement="doctor_detail" aspect="4/1" />
          )}

          {/* Tabs */}
          <div className="space-y-6">
            <div className="flex border-b border-slate-200 gap-8 overflow-x-auto no-scrollbar">
              {[
                { id: "Overview", label: "Tổng quan" },
                { id: "Experience", label: "Kinh nghiệm" },
                { id: "Reviews", label: "Đánh giá" },
                { id: "Business Hours", label: "Giờ làm việc" },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`pb-4 text-sm font-bold transition-all relative whitespace-nowrap ${
                    activeTab === id
                      ? "text-primary"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {label}
                  {activeTab === id && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-full" />
                  )}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-[2rem] border border-slate-200 p-8 shadow-sm space-y-8">
              {activeTab === "Overview" && (
                <>
                  <div className="space-y-4">
                    <h3 className="text-xl font-bold text-slate-900">
                      Giới thiệu
                    </h3>
                    <p className="text-slate-600 leading-relaxed">
                      {doctor.bio ||
                        (expText
                          ? `${doctor.name} — ${doctor.specialty}, ${expText}.`
                          : `${doctor.name} — ${doctor.specialty}.`)}
                    </p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h3 className="text-lg font-bold text-slate-900">
                        Khoa / chuyên môn
                      </h3>
                      {doctor.specialty ? (
                        <p className="text-sm text-slate-600 leading-relaxed">
                          <span className="font-semibold text-slate-900">
                            {doctor.specialty}
                          </span>
                          {doctor.departmentDescription ? (
                            <span className="text-slate-500">
                              {" "}
                              — {doctor.departmentDescription}
                            </span>
                          ) : null}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-500">
                          Chưa có thông tin khoa trên hồ sơ.
                        </p>
                      )}
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-lg font-bold text-slate-900">
                        Học vấn
                      </h3>
                      {doctor.university ? (
                        <ul className="space-y-4">
                          <li className="flex gap-4">
                            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                              <GraduationCap className="w-5 h-5 text-blue-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900">
                                {doctor.university}
                              </p>
                            </div>
                          </li>
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-500">
                          Chưa có thông tin học vấn trên hồ sơ.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {activeTab === "Experience" && (
                <div className="space-y-8">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-4">
                      Kinh nghiệm & học vấn
                    </h3>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 flex gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                          <Briefcase className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                            Kinh nghiệm
                          </p>
                          <p className="text-lg font-bold text-slate-900 mt-1">
                            {expText ?? "Chưa cập nhật"}
                          </p>
                        </div>
                      </div>
                      <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 flex gap-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                          <GraduationCap className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                            Đào tạo
                          </p>
                          <p className="text-lg font-bold text-slate-900 mt-1">
                            {doctor.university ?? "Chưa cập nhật"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {doctor.bio ? (
                    <div className="space-y-3">
                      <h4 className="text-lg font-bold text-slate-900">
                        Tiểu sử
                      </h4>
                      <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">
                        {doctor.bio}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Chưa có mô tả chi tiết trên hồ sơ bác sĩ.
                    </p>
                  )}
                </div>
              )}

              {activeTab === "Business Hours" && (
                <div className="space-y-8">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-4">
                      Giờ làm việc
                    </h3>
                    <div className="space-y-3 text-sm text-slate-600">
                      <p className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-primary shrink-0" />
                        <span>
                          <strong className="text-slate-900">
                            Thứ 2 – Thứ 6:
                          </strong>{" "}
                          08:00 – 11:30 và 13:00 – 17:00
                        </span>
                      </p>
                      <p className="pl-6 text-slate-500">
                        Nghỉ trưa: 11:30 – 13:00 · Mỗi ca khám 15 phút
                      </p>
                      <p className="pl-6 text-slate-500">
                        Thứ 7, Chủ nhật: nghỉ
                      </p>
                    </div>
                  </div>

                  {loadingDetail ? (
                    <p className="text-sm text-slate-500">
                      Đang tải lịch trống...
                    </p>
                  ) : availableDates.length === 0 ? (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                      Hiện chưa có khung giờ trống để đặt. Vui lòng thử lại sau
                      hoặc chọn bác sĩ khác.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      <h4 className="text-lg font-bold text-slate-900">
                        Ngày còn chỗ trống
                      </h4>
                      <ul className="space-y-3">
                        {availableDates.map((d) => {
                          const info = formatSlotDateLabel(d);
                          const daySlots = (slotsByDate[d] ?? []).filter((s) =>
                            isSlotTimeInFuture(s.slotTime),
                          );
                          const times = daySlots
                            .map((s) => formatSlotTime(s.slotTime))
                            .join(", ");
                          return (
                            <li
                              key={d}
                              className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-sm"
                            >
                              <p className="font-bold text-slate-900">
                                {info.label}, {info.full}
                              </p>
                              <p className="text-slate-600 mt-1 text-xs leading-relaxed">
                                {times || "—"}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "Reviews" && (
                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-slate-900">
                      Đánh giá từ bệnh nhân
                    </h3>
                    <button
                      type="button"
                      className="text-sm font-bold text-primary"
                    >
                      Viết đánh giá
                    </button>
                  </div>

                  <div className="space-y-6">
                    {[1, 2].map((i) => (
                      <div
                        key={i}
                        className="p-6 bg-slate-50 rounded-2xl space-y-4"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex gap-4">
                            <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-200">
                              <img
                                src={`https://i.pravatar.cc/150?u=${i + 10}`}
                                alt="Người dùng"
                              />
                            </div>
                            <div>
                              <p className="font-bold text-slate-900">
                                Nguyễn Văn A
                              </p>
                              <p className="text-xs text-slate-500">
                                2 ngày trước
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className="w-3 h-3 text-amber-400 fill-amber-400"
                              />
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          &ldquo;Bác sĩ rất tận tình, giải thích rõ ràng và
                          khiến tôi thoải mái trong suốt buổi khám. Rất đáng đặt
                          lịch.&rdquo;
                        </p>
                        <div className="flex items-center gap-4 pt-2">
                          <button
                            type="button"
                            className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-primary transition-colors"
                          >
                            <ThumbsUp className="w-4 h-4" /> Hữu ích (12)
                          </button>
                          <button
                            type="button"
                            className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-primary transition-colors"
                          >
                            <MessageSquare className="w-4 h-4" /> Trả lời
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="w-full py-4 text-sm font-bold text-slate-600 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-colors"
                  >
                    Xem thêm đánh giá
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Booking Sidebar */}
        <aside className="w-full lg:w-96">
          <div className="bg-white rounded-[2rem] border border-slate-200 p-8 shadow-xl shadow-slate-200/50 sticky top-24 space-y-8">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900">
                Đặt lịch khám
              </h3>
              <div className="text-right">
                <span className="text-xs text-slate-400 block">Phí khám</span>
                <span className="text-2xl font-black text-slate-900">
                  {doctor.fee.toLocaleString("vi-VN")}đ
                </span>
              </div>
            </div>

            <div className="space-y-6">
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900">Chọn ngày</h4>
                {loadingDetail ? (
                  <p className="text-slate-500 text-sm">Đang tải lịch...</p>
                ) : availableDates.length === 0 ? (
                  <p className="text-slate-500 text-sm">
                    Chưa có slot trống trong 2 tuần tới.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {availableDates.slice(0, 8).map((d) => {
                      const info = formatSlotDateLabel(d);
                      const active = d === activeDate;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSelectedDate(d)}
                          className={`p-3 rounded-2xl border transition-all flex flex-col items-center gap-1 ${
                            active
                              ? "bg-primary border-primary text-white shadow-lg shadow-primary/20"
                              : "bg-white border-slate-100 text-slate-600 hover:border-primary/50"
                          }`}
                        >
                          <span className="text-[10px] font-bold uppercase tracking-widest">
                            {info.label}
                          </span>
                          <span className="text-lg font-black">
                            {info.short}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900">Khung giờ</h4>
                {!activeDate && !loadingDetail ? (
                  <p className="text-slate-500 text-sm">
                    Chọn ngày để xem giờ.
                  </p>
                ) : timeSlotsForDate.length === 0 && !loadingDetail ? (
                  <p className="text-slate-500 text-sm">
                    Không còn khung giờ trống trong ngày này.
                  </p>
                ) : loadingDetail ? (
                  <p className="text-slate-500 text-sm">Đang tải...</p>
                ) : (
                  <div className="space-y-3 max-h-52 overflow-y-auto">
                    {(() => {
                      const morning = timeSlotsForDate.filter(
                        (s) => new Date(s.slotTime).getHours() < 12,
                      );
                      const afternoon = timeSlotsForDate.filter(
                        (s) => new Date(s.slotTime).getHours() >= 12,
                      );
                      const renderGroup = (
                        label: string,
                        group: typeof timeSlotsForDate,
                      ) =>
                        group.length === 0 ? null : (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                              {label}
                            </p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {group.map((s) => {
                                const future = isSlotTimeInFuture(s.slotTime);
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    disabled={!future}
                                    className={`py-2 px-1 rounded-xl border text-[11px] font-bold transition-all ${
                                      future
                                        ? "border-slate-100 text-slate-600 hover:border-primary/50"
                                        : "border-slate-50 text-slate-300 cursor-not-allowed"
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
                        <>
                          {renderGroup("☀️ Sáng", morning)}
                          {renderGroup("🌤 Chiều", afternoon)}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900">
                  Hình thức khám
                </h4>
                <div className="p-4 rounded-2xl border-2 border-primary bg-primary/5 flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white shrink-0">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-primary block">
                      Khám trực tiếp
                    </span>
                    <span className="text-[11px] text-slate-600">
                      Đặt lịch và đến khám tại cơ sở y tế
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onBook(doctor)}
              disabled={availableDates.length === 0}
              className="w-full py-5 bg-primary text-white rounded-[1.5rem] font-bold text-lg shadow-xl shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Tiếp tục đặt lịch <ChevronRight className="w-5 h-5" />
            </button>

            <p className="text-[10px] text-center text-slate-400 font-medium">
              Bằng việc nhấn tiếp tục, bạn đồng ý với{" "}
              <a href="#" className="underline">
                Điều khoản dịch vụ
              </a>{" "}
              và{" "}
              <a href="#" className="underline">
                Chính sách bảo mật
              </a>{" "}
              của chúng tôi.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};
