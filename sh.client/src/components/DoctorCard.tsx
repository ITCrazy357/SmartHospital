import React from "react";
import { MapPin, Clock, CheckCircle, Calendar } from "lucide-react";
import { Doctor } from "../types";
import { useBookingPolicy } from "../contexts/BookingPolicyContext";

interface DoctorCardProps {
  doctor: Doctor;
  onBook: (doctor: Doctor) => void;
  onViewProfile: (doctor: Doctor) => void;
  /** Dùng trên trang chủ: card gọn, nút nhỏ hơn */
  compact?: boolean;
}

export const DoctorCard: React.FC<DoctorCardProps> = ({
  doctor,
  onBook,
  onViewProfile,
  compact,
}) => {
  const { consultationFee } = useBookingPolicy();
  if (compact) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg hover:shadow-slate-200/40 transition-all group">
        <div className="p-4 flex flex-col sm:flex-row gap-4">
          <div className="relative shrink-0">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-slate-100">
              <img
                src={doctor.image}
                alt={doctor.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            </div>
            {doctor.online && (
              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="mb-0.5">
              <h3
                className="text-base font-bold text-slate-900 truncate cursor-pointer hover:text-primary transition-colors"
                onClick={() => onViewProfile(doctor)}
              >
                {doctor.name}
              </h3>
            </div>
            <p className="text-xs text-primary mb-2">{doctor.specialty}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-500 mb-3">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span className="text-[11px]">{doctor.experience} năm</span>
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                <span className="text-[11px] truncate max-w-[100px]">
                  {doctor.availability}
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-sm font-bold text-slate-900">
                {consultationFee.toLocaleString("vi-VN")}đ
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onViewProfile(doctor)}
                  className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Chi tiết
                </button>
                <button
                  type="button"
                  onClick={() => onBook(doctor)}
                  disabled={doctor.fullyBooked}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${doctor.fullyBooked ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-primary text-white hover:bg-primary/90"}`}
                >
                  {doctor.fullyBooked ? "Hết lịch" : "Đặt lịch"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl hover:shadow-slate-200/50 transition-all group">
      <div className="p-5 flex flex-col sm:flex-row gap-6">
        <div className="relative shrink-0">
          <div className="w-32 h-32 rounded-2xl overflow-hidden bg-slate-100">
            <img
              src={doctor.image}
              alt={doctor.name}
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
            />
          </div>
          {doctor.online && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 border-4 border-white rounded-full" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="mb-1">
            <h3
              className="text-lg font-bold text-slate-900 truncate cursor-pointer hover:text-primary transition-colors"
              onClick={() => onViewProfile(doctor)}
            >
              {doctor.name}
            </h3>
          </div>
          <p className="text-sm font-medium text-primary mb-3">
            {[doctor.specialty, doctor.degree].filter(Boolean).join(" • ") ||
              "Bác sĩ"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 mb-4">
            <div className="flex items-center gap-2 text-slate-500">
              <Clock className="w-4 h-4" />
              <span className="text-xs">
                {doctor.experience} năm kinh nghiệm
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <MapPin className="w-4 h-4" />
              <span className="text-xs truncate">{doctor.location}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <CheckCircle className="w-4 h-4" />
              <span className="text-xs">Xem lịch khám</span>
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <Calendar className="w-4 h-4" />
              <span className="text-xs font-medium text-slate-700">
                {doctor.availability}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <div>
              <span className="text-xs text-slate-400 block">Phí khám</span>
              <span className="text-lg font-bold text-slate-900">
                {consultationFee.toLocaleString("vi-VN")}đ
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onViewProfile(doctor)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Xem chi tiết
              </button>
              <button
                type="button"
                onClick={() => onBook(doctor)}
                disabled={doctor.fullyBooked}
                className={`px-5 py-2 text-sm font-bold rounded-xl transition-all ${doctor.fullyBooked ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20"}`}
              >
                {doctor.fullyBooked ? "Hết lịch" : "Đặt lịch"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
