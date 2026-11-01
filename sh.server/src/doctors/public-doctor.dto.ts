import { UserEntity } from '../models/user.model';

/** Public directory fields only; never serialize a users entity directly. */
export interface PublicDoctorDto {
  id: string;
  fullName: string;
  departmentId: string | null;
  bio: string | null;
  experienceYears: number | null;
  university: string | null;
  avatarUrl: string | null;
  createdAt: string;
  department: { id: string; name: string; description: string | null } | null;
}

export function publicDoctor(user: UserEntity): PublicDoctorDto {
  return {
    id: user.id,
    fullName: user.fullName,
    departmentId: user.departmentId,
    bio: user.bio,
    experienceYears: user.experienceYears,
    university: user.university,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
    department: user.department ? {
      id: user.department.id,
      name: user.department.name,
      description: user.department.description,
    } : null,
  };
}
