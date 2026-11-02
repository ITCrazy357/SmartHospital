import { request, type ApiDoctor } from './client';

export interface DoctorSearchResponse {
  items: ApiDoctor[]; total: number; page: number; pageSize: number; departmentCounts: Record<string, number>;
}
export function searchDoctors(input: { page: number; pageSize: number; q?: string; departmentId?: string; experience: string[]; availability: string[] }) {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  if (input.q) query.set('q', input.q);
  if (input.departmentId) query.set('departmentId', input.departmentId);
  if (input.experience.length) query.set('experience', input.experience.join(','));
  if (input.availability.length) query.set('availability', input.availability.join(','));
  return request<DoctorSearchResponse>(`/doctors/search?${query}`);
}
