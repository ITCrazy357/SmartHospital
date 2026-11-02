import type { LucideIcon } from "lucide-react";
import type { Doctor, Department } from "../types";
import type { ApiDepartment, ApiDoctor, ApiDoctorSchedule } from "./client";
import { resolveApiAssetUrl } from "./client";
import { formatDoctorName } from "../utils/formatDoctorName";
import { DEFAULT_CONSULTATION_FEE_VND } from "../constants";

/** Map API department + UI style (icon, color) -> Department for UI */
export function mapDepartment(
  api: ApiDepartment,
  style: { icon: LucideIcon; color: string; specialistsCount: number },
): Department {
  return {
    id: api.id,
    name: api.name,
    icon: style.icon,
    specialistsCount: style.specialistsCount,
    color: style.color,
  };
}

/** Map API doctor -> Doctor for UI (card, profile, booking) */
export function mapDoctor(api: ApiDoctor): Doctor {
  const specialty = api.department?.name ?? "Bác sĩ";
  const deptDesc = api.department?.description?.trim();
  return {
    id: api.id,
    name: formatDoctorName(api.fullName),
    specialty,
    degree: "",
    rating: 0,
    reviewsCount: 0,
    experience: api.experienceYears ?? 0,
    location: import.meta.env.VITE_CLINIC_NAME || "Phòng khám",
    hospital: import.meta.env.VITE_CLINIC_NAME || "Phòng khám",
    availability: "Xem lịch",
    image:
      resolveApiAssetUrl(api.avatarUrl) ??
      "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=400",
    fullyBooked: false,
    fee: DEFAULT_CONSULTATION_FEE_VND,
    bio: api.bio ?? undefined,
    university: api.university ?? undefined,
    departmentDescription: deptDesc ? deptDesc : undefined,
  };
}

export type { ApiDoctorSchedule };
