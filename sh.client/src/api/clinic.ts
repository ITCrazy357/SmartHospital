import {
  ApiRequestError,
  AUTH_CLEARED_EVENT,
  clearStoredAuth,
  getStoredToken,
} from "./client";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
async function request<T>(
  path: string,
  body?: unknown,
  method = "GET",
): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(`${BASE}/clinic${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      clearStoredAuth();
      window.dispatchEvent(new CustomEvent(AUTH_CLEARED_EVENT));
    }
    const message =
      typeof json.message === "string"
        ? json.message
        : Array.isArray(json.message)
          ? json.message.join("; ")
          : "Không thực hiện được thao tác";
    throw new ApiRequestError(message, { statusCode: response.status });
  }
  return json as T;
}
export interface ClinicPatient {
  id: string;
  patient_code: string;
  user_id: string | null;
  full_name: string;
  date_of_birth: string | null;
  sex: string;
  phone: string | null;
  address: string | null;
  allergies?: string | null;
  medical_history?: string | null;
  version: number;
  total?: number;
}
export interface ClinicDoctor {
  id: string;
  full_name: string;
}
export interface ClinicAccount extends ClinicDoctor {
  email: string;
  phone: string | null;
}
export interface PatientAccess extends ClinicAccount {
  user_id: string;
  relationship: string;
}
export interface ClinicVisit {
  id: string;
  patient_id: string;
  doctor_id: string;
  appointment_id: string | null;
  scheduled_at: string;
  source: string;
  status: string;
  queue_number: string;
  consultation_fee: string;
  symptoms: string | null;
  version: number;
  patient_name: string;
  patient_code: string;
  doctor_name: string;
  encounter_status?: string;
  paid_amount: string;
}
export interface ClinicEncounter {
  id: string;
  version: number;
  status: "draft" | "final";
  vitals: Record<string, number>;
  symptoms: string | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
  follow_up_date: string | null;
  updated_at: string;
}
export interface ClinicLedger {
  id: string;
  visit_id: string;
  kind: string;
  amount: string;
  method: string;
  reference: string | null;
  reason: string | null;
  recorded_by: string;
  created_at: string;
}
export interface ClinicRefund {
  id: string;
  visit_id: string;
  amount: string;
  reason: string;
  status: string;
  requested_by: string;
  review_note: string | null;
  payment_reference: string | null;
  patient_name?: string;
}
export interface ClinicRevision {
  id: string;
  version: number;
  reason: string;
  changed_by_name: string;
  created_at: string;
  snapshot: ClinicEncounter;
}
export interface ClinicDetail {
  visit: ClinicVisit;
  patient: ClinicPatient;
  encounter: ClinicEncounter | null;
  ledger: ClinicLedger[];
  refunds: ClinicRefund[];
  revisions: ClinicRevision[];
  reconciliation?: {
    id: string;
    amount: string;
    reconciliation_status: string;
    reconciliation_reason: string | null;
  }[];
  medicalRecordVersion: number;
  legacyMedicalRecord: Pick<
    ClinicEncounter,
    "symptoms" | "diagnosis" | "treatment" | "notes"
  > | null;
}
export interface ClinicOnlineAppointment {
  id: string;
  patient_name: string;
  phone: string | null;
  doctor_name: string;
  slot_time: string;
  status: string;
  imported: boolean;
}
export interface ClinicWaitlist {
  id: string;
  patient_id: string;
  doctor_id: string;
  patient_name: string;
  patient_code: string;
  doctor_name: string;
  preferred_date: string;
  note: string | null;
  status: string;
  offered_slot_id: string | null;
  slot_time: string | null;
  requiresBooking?: boolean;
}
export interface ClinicFollowup {
  visit_id: string;
  patient_id: string;
  doctor_id: string;
  patient_name: string;
  patient_code: string;
  phone: string | null;
  doctor_name: string;
  follow_up_date: string;
}
export interface ClinicOperations {
  unimported: { id: string; patient_name: string; slot_time: string }[];
  unfinished: {
    id: string;
    patient_name: string;
    status: string;
    scheduled_at: string;
    doctor_name: string;
  }[];
  reconciliation: {
    id: string;
    appointment_id: string;
    amount: string;
    status: string;
    appointment_status: string;
    payos_order_code: string;
  }[];
  refunds: ClinicRefund[];
  reminders: {
    appointment_id: string;
    kind: string;
    status: string;
    attempts: number;
    last_error: string | null;
    next_attempt_at: string | null;
  }[];
}
export interface ClinicTask {
  id: string;
  kind: string;
  target_id: string;
  target_label: string | null;
  assigned_to: string;
  assignee_name: string;
  status: string;
  note: string | null;
  version: number;
  updated_at: string;
}
export const clinicApi = {
  patients: (q = "", page = 1) =>
    request<ClinicPatient[]>(
      `/patients?q=${encodeURIComponent(q)}&page=${page}`,
    ),
  createPatient: (body: unknown) =>
    request<ClinicPatient>("/patients", body, "POST"),
  updatePatient: (id: string, body: unknown) =>
    request<ClinicPatient>(`/patients/${id}`, body, "PATCH"),
  accounts: (q: string) =>
    request<ClinicAccount[]>(`/accounts?q=${encodeURIComponent(q)}`),
  access: (id: string) => request<PatientAccess[]>(`/patients/${id}/access`),
  grantAccess: (id: string, body: unknown) =>
    request(`/patients/${id}/access`, body, "POST"),
  revokeAccess: (id: string, userId: string) =>
    request(`/patients/${id}/access/${userId}`, undefined, "DELETE"),
  doctors: () => request<ClinicDoctor[]>("/doctors"),
  onlineAppointments: (day: string) =>
    request<ClinicOnlineAppointment[]>(`/appointments?day=${day}`),
  importAppointment: (id: string) =>
    request<ClinicVisit>(`/appointments/${id}/import`, {}, "POST"),
  visits: (day: string, status = "") =>
    request<ClinicVisit[]>(`/visits?day=${day}&status=${status}`),
  createVisit: (body: unknown) => request<ClinicVisit>("/visits", body, "POST"),
  detail: (id: string) => request<ClinicDetail>(`/visits/${id}`),
  transition: (id: string, body: unknown) =>
    request(`/visits/${id}/transition`, body, "POST"),
  encounter: (id: string, body: unknown) =>
    request<ClinicEncounter>(`/visits/${id}/encounter`, body, "POST"),
  collect: (id: string, body: unknown) =>
    request<ClinicLedger>(`/visits/${id}/collections`, body, "POST"),
  refund: (id: string, body: unknown) =>
    request<ClinicRefund>(`/visits/${id}/refunds`, body, "POST"),
  reviewRefund: (id: string, body: unknown) =>
    request<ClinicRefund>(`/refunds/${id}/review`, body, "POST"),
  payRefund: (id: string, body: unknown) =>
    request<ClinicRefund>(`/refunds/${id}/pay`, body, "POST"),
  transfer: (id: string, body: unknown) =>
    request(`/visits/${id}/transfer`, body, "POST"),
  reconcilePayment: (id: string, body: { confirmed: boolean; note: string }) =>
    request<ClinicVisit>(`/payments/${id}/reconciliation`, body, "POST"),
  resolveReconciliation: (
    id: string,
    body: { confirmed: boolean; note: string },
  ) => request(`/visits/${id}/reconciliation/resolve`, body, "POST"),
  waitlist: () => request<ClinicWaitlist[]>("/waitlist"),
  addWaitlist: (body: unknown) =>
    request<ClinicWaitlist>("/waitlist", body, "POST"),
  offerWaitlist: (id: string, slotId: string) =>
    request<ClinicWaitlist>(`/waitlist/${id}/offer`, { slotId }, "POST"),
  confirmWaitlist: (id: string) =>
    request<ClinicWaitlist>(
      `/waitlist/${id}/confirm`,
      { confirmed: true },
      "POST",
    ),
  cancelWaitlist: (id: string) => request(`/waitlist/${id}/cancel`, {}, "POST"),
  followUps: () => request<ClinicFollowup[]>("/follow-ups"),
  operations: () => request<ClinicOperations>("/operations"),
  tasks: () => request<ClinicTask[]>("/operations/tasks"),
  claimTask: (kind: string, targetId: string) =>
    request<ClinicTask>("/operations/tasks", { kind, targetId }, "POST"),
  updateTask: (id: string, body: unknown) =>
    request<ClinicTask>(`/operations/tasks/${id}`, body, "PATCH"),
};
