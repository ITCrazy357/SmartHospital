const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** URL đầy đủ cho ảnh tĩnh API (vd: `/upload/xxx.jpg` → gốc API). */
export function resolveApiAssetUrl(
  url: string | null | undefined,
): string | undefined {
  if (url == null || url === "") return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${API_BASE}${path}`;
}

const AUTH_TOKEN_KEY = "sh_auth_token";
const AUTH_USER_KEY = "sh_auth_user";

export function getStoredToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredAuth(token: string, user: ApiAuthUser): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

/** Event name khi token bị từ chối (401) — App.tsx subscribe để reset state user. */
export const AUTH_CLEARED_EVENT = "sh:auth-cleared";

export function getStoredUser(): ApiAuthUser | null {
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ApiAuthUser;
  } catch {
    return null;
  }
}

export class ApiRequestError extends Error {
  readonly fieldErrors?: Record<string, string>;
  readonly statusCode?: number;
  constructor(
    message: string,
    opts?: { fieldErrors?: Record<string, string>; statusCode?: number },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.fieldErrors = opts?.fieldErrors;
    this.statusCode = opts?.statusCode;
  }
}

export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = getStoredToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options?.headers,
  };
  if (token)
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    // Token hết hạn / không hợp lệ — xoá session + báo App.tsx đẩy về home, không để dashboard sót state.
    if (res.status === 401 && getStoredToken()) {
      clearStoredAuth();
      try {
        window.dispatchEvent(new CustomEvent(AUTH_CLEARED_EVENT));
      } catch {
        /* SSR / non-browser env */
      }
    }
    let msg = text || `HTTP ${res.status}`;
    let fieldErrors: Record<string, string> | undefined;
    try {
      const j = JSON.parse(text) as {
        message?: string | string[] | { errors?: Record<string, string> };
        errors?: Record<string, string>;
      };
      if (
        j.errors &&
        typeof j.errors === "object" &&
        !Array.isArray(j.errors)
      ) {
        fieldErrors = j.errors as Record<string, string>;
        msg = "Dữ liệu không hợp lệ";
      } else {
        const m = j.message;
        if (
          m &&
          typeof m === "object" &&
          !Array.isArray(m) &&
          "errors" in m &&
          m.errors &&
          typeof m.errors === "object"
        ) {
          fieldErrors = m.errors as Record<string, string>;
          msg = "Dữ liệu không hợp lệ";
        } else if (typeof m === "string") msg = m;
        else if (Array.isArray(m)) msg = m.join("; ");
      }
    } catch {
      /* giữ msg */
    }
    throw new ApiRequestError(msg, { fieldErrors, statusCode: res.status });
  }
  return res.json() as Promise<T>;
}

export const api = {
  getDepartments: () => request<ApiDepartment[]>("/departments"),

  getDepartment: (id: string) => request<ApiDepartment>(`/departments/${id}`),

  getDoctors: (departmentId?: string) => {
    const q = departmentId
      ? `?departmentId=${encodeURIComponent(departmentId)}`
      : "";
    return request<ApiDoctor[]>(`/doctors${q}`);
  },

  getDoctor: (id: string) => request<ApiDoctor>(`/doctors/${id}`),

  getDoctorSlots: (doctorId: string, fromDate?: string) => {
    const q = fromDate ? `?from=${encodeURIComponent(fromDate)}` : "";
    return request<ApiAppointmentSlot[]>(`/doctors/${doctorId}/slots${q}`);
  },

  getDoctorSchedules: (doctorId: string, workDay?: string) => {
    const q = workDay ? `?workDay=${encodeURIComponent(workDay)}` : "";
    return request<ApiDoctorSchedule[]>(`/doctors/${doctorId}/schedules${q}`);
  },

  // Auth (map theo model UserPublic)
  login: (email: string, password: string) =>
    request<ApiAuthResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (body: {
    email: string;
    password: string;
    confirmPassword: string;
    fullName: string;
    phone: string;
  }) =>
    request<ApiRegisterSuccess>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  forgotPassword: (email: string) =>
    request<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (body: {
    token: string;
    password: string;
    confirmPassword: string;
  }) =>
    request<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  logout: () =>
    request<{ message: string }>("/auth/logout", { method: "POST" }),

  getMe: () => request<{ user: ApiAuthUser }>("/auth/me"),

  updateMyProfile: (body: { fullName: string; phone: string }) =>
    request<{ user: ApiAuthUser }>("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  changeMyPassword: (body: {
    currentPassword: string;
    password: string;
    confirmPassword: string;
  }) =>
    request<{ message: string }>("/auth/me/password", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  updateMyAvatar: async (avatarFile: File) => {
    const fd = new FormData();
    fd.append("avatar", avatarFile);
    const token = getStoredToken();
    const headers: HeadersInit = {};
    if (token)
      (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/auth/me/avatar`, {
      method: "PATCH",
      headers,
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ user: ApiAuthUser }>;
  },

  // Admin
  getAdminUsers: (role?: UserRole) => {
    const q = role ? `?role=${role}` : "";
    return request<ApiAuthUser[]>(`/admin/users${q}`);
  },

  /** Tạo bệnh nhân hoặc admin (bác sĩ dùng createDoctor). */
  adminCreateUser: (body: {
    email: string;
    password: string;
    fullName: string;
    phone?: string | null;
    role: "user" | "admin" | "receptionist" | "cashier";
  }) =>
    request<ApiAuthUser>("/admin/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  adminUpdateUser: (
    userId: string,
    body: {
      fullName?: string;
      email?: string;
      phone?: string | null;
      role?: "user" | "admin" | "receptionist" | "cashier";
      departmentId?: string | null;
      bio?: string | null;
      experienceYears?: number | null;
      university?: string | null;
    },
  ) =>
    request<ApiAuthUser>(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  adminDeleteUser: (userId: string) =>
    request<{ message: string }>(`/admin/users/${userId}`, {
      method: "DELETE",
    }),

  adminSetUserPassword: (
    userId: string,
    body: { password: string; confirmPassword: string },
  ) =>
    request<{ message: string }>(`/admin/users/${userId}/password`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  getAdminDoctor: (id: string) =>
    request<{ user: ApiAuthUser }>(`/admin/doctors/${id}`),

  getAdminPayments: (params?: {
    from?: string;
    to?: string;
    status?: "pending" | "paid" | "failed";
  }) => {
    const sp = new URLSearchParams();
    if (params?.from) sp.set("from", params.from);
    if (params?.to) sp.set("to", params.to);
    if (params?.status) sp.set("status", params.status);
    const q = sp.toString();
    return request<ApiAdminPaymentRow[]>(`/admin/payments${q ? `?${q}` : ""}`);
  },

  getAdminStatsOverview: (from?: string, to?: string) => {
    const sp = new URLSearchParams();
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    const q = sp.toString();
    return request<ApiAdminStatsOverview>(
      `/admin/stats/overview${q ? `?${q}` : ""}`,
    );
  },

  // ============ Quảng cáo (PB38) ============
  getAdminAds: (params?: {
    status?: AdStatus | "";
    placement?: AdPlacement | "";
    q?: string;
  }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set("status", params.status);
    if (params?.placement) sp.set("placement", params.placement);
    if (params?.q) sp.set("q", params.q);
    const q = sp.toString();
    return request<ApiAdminAd[]>(`/admin/ads${q ? `?${q}` : ""}`);
  },

  getAdminAd: (id: string) => request<ApiAdminAd>(`/admin/ads/${id}`),

  upsertAdminAd: async (
    body: ApiAdUpsertBody,
    imageFile?: File | null,
    options?: { id?: string; removeImage?: boolean },
  ) => {
    const fd = new FormData();
    if (body.type !== undefined) fd.append("type", body.type);
    if (body.title !== undefined) fd.append("title", body.title);
    if (body.body !== undefined) fd.append("body", body.body ?? "");
    if (body.linkUrl !== undefined) fd.append("linkUrl", body.linkUrl ?? "");
    if (body.placements !== undefined) {
      fd.append("placements", JSON.stringify(body.placements));
    }
    if (body.status !== undefined) fd.append("status", body.status);
    if (body.priority !== undefined)
      fd.append("priority", String(body.priority));
    if (body.startAt !== undefined) fd.append("startAt", body.startAt ?? "");
    if (body.endAt !== undefined) fd.append("endAt", body.endAt ?? "");
    if (imageFile) fd.append("image", imageFile);
    if (options?.removeImage) fd.append("removeImage", "1");

    const token = getStoredToken();
    if (!token) throw new Error("Chưa đăng nhập admin.");
    const url = options?.id
      ? `${API_BASE}/admin/ads/${options.id}`
      : `${API_BASE}/admin/ads`;
    const method = options?.id ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json() as Promise<ApiAdminAd>;
  },

  patchAdminAdStatus: (id: string, status: AdStatus) =>
    request<ApiAdminAd>(`/admin/ads/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  deleteAdminAd: (id: string) =>
    request<{ message: string }>(`/admin/ads/${id}`, { method: "DELETE" }),

  /** Public — chính sách đặt lịch (tiền cọc + phí khám). Không cần đăng nhập. */
  getBookingPolicy: () =>
    request<{ depositAmount: number; consultationFee: number }>(
      "/config/booking-policy",
    ),

  /** Lấy cấu hình hệ thống (deposit_amount). */
  getAdminConfig: () => request<{ depositAmount: number }>("/admin/config"),

  /** Cập nhật tiền cọc đặt lịch. */
  setDepositAmount: (amount: number) =>
    request<{ depositAmount: number; message: string }>(
      "/admin/config/deposit-amount",
      {
        method: "PATCH",
        body: JSON.stringify({ amount }),
      },
    ),

  /** Public — lấy quảng cáo đang hiệu lực theo vị trí */
  getAds: (placement: AdPlacement) =>
    request<ApiPublicAd[]>(`/ads?placement=${encodeURIComponent(placement)}`, {
      cache: "no-store",
    }),

  trackAdClick: (id: string) =>
    request<{ ok: true }>(`/ads/${id}/click`, { method: "POST" }),

  trackAdView: (id: string) =>
    request<{ ok: true }>(`/ads/${id}/view`, { method: "POST" }),

  updateDoctor: async (
    doctorId: string,
    body: ApiUpdateDoctorBody,
    avatarFile?: File | null,
  ) => {
    const fd = new FormData();
    fd.append("fullName", body.fullName);
    fd.append("email", body.email);
    fd.append("phone", body.phone ?? "");
    if (body.departmentId) fd.append("departmentId", body.departmentId);
    else fd.append("departmentId", "");
    if (body.bio != null && body.bio !== "") fd.append("bio", body.bio);
    else fd.append("bio", "");
    if (body.experienceYears != null && !Number.isNaN(body.experienceYears)) {
      fd.append("experienceYears", String(body.experienceYears));
    } else fd.append("experienceYears", "");
    if (body.university != null && body.university.trim() !== "")
      fd.append("university", body.university.trim());
    else fd.append("university", "");
    if (avatarFile) fd.append("avatar", avatarFile);

    const token = getStoredToken();
    if (!token) {
      throw new Error(
        "Chưa có phiên đăng nhập. Vui lòng đăng nhập bằng tài khoản quản trị (admin) rồi thử lại.",
      );
    }
    const headers: HeadersInit = { Authorization: `Bearer ${token}` };
    const res = await fetch(`${API_BASE}/admin/doctors/${doctorId}`, {
      method: "PATCH",
      headers,
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        throw new Error(
          "Phiên đăng nhập hết hạn hoặc token không hợp lệ. Hãy đăng nhập lại bằng tài khoản admin.",
        );
      }
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ user: ApiAuthUser }>;
  },

  setDoctorPassword: (
    doctorId: string,
    body: { password: string; confirmPassword: string },
  ) =>
    request<{ message: string }>(`/admin/doctors/${doctorId}/password`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  setDoctorLocked: (doctorId: string, locked: boolean) =>
    request<{ message: string }>(`/admin/doctors/${doctorId}/lock`, {
      method: "PATCH",
      body: JSON.stringify({ locked }),
    }),

  createDoctor: async (body: ApiCreateDoctorBody, avatarFile?: File | null) => {
    const fd = new FormData();
    fd.append("email", body.email);
    fd.append("password", body.password);
    fd.append("fullName", body.fullName);
    if (body.phone) fd.append("phone", body.phone);
    if (body.departmentId) fd.append("departmentId", body.departmentId);
    if (body.bio != null && body.bio !== "") fd.append("bio", body.bio);
    if (body.experienceYears != null && !Number.isNaN(body.experienceYears)) {
      fd.append("experienceYears", String(body.experienceYears));
    }
    if (body.university != null && body.university.trim() !== "")
      fd.append("university", body.university.trim());
    if (avatarFile) fd.append("avatar", avatarFile);

    const token = getStoredToken();
    if (!token) {
      throw new Error(
        "Chưa có phiên đăng nhập. Vui lòng đăng nhập bằng tài khoản quản trị (admin) rồi thử lại.",
      );
    }
    const headers: HeadersInit = {
      Authorization: `Bearer ${token}`,
    };

    const res = await fetch(`${API_BASE}/admin/doctors`, {
      method: "POST",
      headers,
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        throw new Error(
          "Phiên đăng nhập hết hạn hoặc token không hợp lệ. Hãy đăng xuất, đăng nhập lại bằng tài khoản admin (hoặc kiểm tra VITE_API_URL trùng với server bạn đã đăng nhập).",
        );
      }
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ user: ApiAuthUser }>;
  },

  createDepartment: (body: { name: string; description?: string | null }) =>
    request<ApiDepartment>("/departments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateDepartment: (
    id: string,
    body: { name?: string; description?: string | null },
  ) =>
    request<ApiDepartment>(`/departments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteDepartment: (id: string) =>
    request<{ message: string }>(`/departments/${id}`, { method: "DELETE" }),

  // Doctor (my slots - read-only, do hệ thống generate khi admin thêm bác sĩ)
  getMySlots: (fromDate?: string) => {
    const q = fromDate ? `?from=${encodeURIComponent(fromDate)}` : "";
    return request<ApiAppointmentSlot[]>(`/doctor/me/slots${q}`);
  },

  getMyLeaveRequests: () =>
    request<ApiDoctorLeaveRequest[]>("/doctor/me/leave-requests"),

  getMyDoctorPatients: () => request<ApiDoctorPatient[]>("/doctor/me/patients"),

  getMyDoctorAppointments: (fromDate?: string, toDate?: string) => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const q = params.toString();
    return request<ApiDoctorAppointment[]>(
      `/doctor/me/appointments${q ? `?${q}` : ""}`,
    );
  },

  createLeaveRequest: (body: {
    startDate: string;
    endDate: string;
    reason?: string | null;
  }) =>
    request<ApiDoctorLeaveRequest>("/doctor/me/leave-requests", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getAdminLeaveRequests: (status?: "pending" | "approved" | "rejected") => {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<ApiDoctorLeaveRequest[]>(`/admin/leave-requests${q}`);
  },

  approveLeaveRequest: (id: string) =>
    request<ApiDoctorLeaveRequest>(`/admin/leave-requests/${id}/approve`, {
      method: "POST",
    }),

  rejectLeaveRequest: (id: string) =>
    request<ApiDoctorLeaveRequest>(`/admin/leave-requests/${id}/reject`, {
      method: "POST",
    }),

  getDoctorPendingMedicalAppointments: () =>
    request<ApiDoctorPendingMedicalAppointment[]>(
      "/medical-records/me/pending-appointments",
    ),

  createDoctorMedicalRecord: (body: {
    appointmentId: string;
    symptoms?: string | null;
    diagnosis?: string | null;
    treatment?: string | null;
    notes?: string | null;
  }) =>
    request<ApiCreateMedicalRecordResult>("/medical-records/me", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getMyMedicalRecords: () =>
    request<ApiDoctorMedicalRecordListItem[]>("/medical-records/me/records"),

  updateDoctorMedicalRecord: (
    recordId: string,
    body: {
      version: number;
      reason: string;
      symptoms?: string | null;
      diagnosis?: string | null;
      treatment?: string | null;
      notes?: string | null;
    },
  ) =>
    request<ApiCreateMedicalRecordResult>(
      `/medical-records/me/records/${recordId}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),

  getMyDoctorStats: (fromDate?: string, toDate?: string) => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const q = params.toString();
    return request<ApiDoctorStats>(
      `/medical-records/me/stats${q ? `?${q}` : ""}`,
    );
  },

  // Appointments (đặt lịch + PayOS). returnUrl/cancelUrl: sau thanh toán PayOS redirect về client.
  createAppointment: (body: {
    slotId: string;
    symptoms?: string | null;
    returnUrl?: string;
    cancelUrl?: string;
  }) =>
    request<ApiCreateAppointmentResult>("/appointments", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getMyAppointments: (page = 1) =>
    request<ApiAppointment[]>(`/appointments/me?page=${page}`),

  getAppointmentStatus: (id: string) =>
    request<import("../components/BookingResult").BookingStatus>(
      `/appointments/${id}/status`,
    ),
  resumeAppointmentCheckout: (id: string) =>
    request<ApiCreateAppointmentResult>(`/appointments/${id}/checkout`, {
      method: "POST",
      body: "{}",
    }),
  rescheduleAppointment: (id: string, slotId: string, reason: string) =>
    request(`/appointments/${id}/reschedule`, {
      method: "POST",
      body: JSON.stringify({ slotId, reason }),
    }),
  setUserLocked: (id: string, locked: boolean) =>
    request<{ message: string }>(`/admin/users/${id}/lock`, {
      method: "PATCH",
      body: JSON.stringify({ locked }),
    }),

  getMyPayments: (page = 1) =>
    request<ApiPaymentHistoryItem[]>(`/appointments/me/payments?page=${page}`),

  /** Bệnh nhân: toàn bộ hồ sơ khám đã có (mới nhất trước). */
  getMyPatientMedicalRecords: () =>
    request<ApiPatientMedicalRecord[]>("/medical-records/me/patient"),

  /** Bệnh nhân: kết quả khám của 1 cuộc hẹn cụ thể. */
  getPatientMedicalRecordByAppointment: (appointmentId: string) =>
    request<ApiPatientMedicalRecord>(
      `/medical-records/me/patient/by-appointment/${appointmentId}`,
    ),

  /**
   * Bệnh nhân huỷ cuộc hẹn của chính mình.
   * Lưu ý: HUỶ = MẤT CỌC theo policy hiện tại.
   */
  cancelMyAppointment: (appointmentId: string, reason?: string | null) =>
    request<{ id: string; status: string; depositRefunded: boolean }>(
      `/appointments/${appointmentId}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ reason: reason ?? null }),
      },
    ),

  /** Admin force-cancel cuộc hẹn (vd bác sĩ ốm đột xuất). */
  adminCancelAppointment: (appointmentId: string, reason?: string | null) =>
    request<{ id: string; status: string; depositRefunded: boolean }>(
      `/admin/appointments/${appointmentId}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ reason: reason ?? null }),
      },
    ),

  /**
   * Admin chạy thủ công job nhắc lịch (gửi email H-24 / H-1).
   * Idempotent — cuộc hẹn đã nhận mail mốc nào sẽ không gửi lại.
   */
  runAppointmentReminders: () =>
    request<{
      h24Sent: number;
      h1Sent: number;
      h24Failed: number;
      h1Failed: number;
      skipped: number;
    }>("/admin/appointments/reminders/run", { method: "POST" }),

  /**
   * Admin gửi MAIL TEST cho 1 cuộc hẹn cụ thể (subject [TEST]). Bỏ qua cửa sổ
   * thời gian và log idempotency — bấm nhiều lần đều gửi.
   */
  sendAppointmentReminderTest: (appointmentId: string, kind: "h24" | "h1") =>
    request<{ to: string; kind: "h24" | "h1" }>(
      `/admin/appointments/${appointmentId}/send-reminder-test`,
      {
        method: "POST",
        body: JSON.stringify({ kind }),
      },
    ),

  /**
   * Gợi ý chuyên khoa bằng AI dựa trên triệu chứng tự do.
   * Public — không cần đăng nhập.
   */
  aiSuggestDepartments: (symptoms: string) =>
    request<ApiSpecialtySuggestion>("/ai/suggest-departments", {
      method: "POST",
      body: JSON.stringify({ symptoms }),
    }),

  /**
   * Gợi ý slot khám tối ưu dựa trên: lịch sử đặt khám của user (pattern giờ/thứ),
   * mức độ khẩn của triệu chứng (AI phân loại), và slot trống của bác sĩ.
   * Cần đăng nhập (role=user).
   */
  aiSuggestSlots: (args: {
    doctorId: string;
    symptoms?: string | null;
    daysAhead?: number;
  }) =>
    request<ApiSlotSuggestion>("/ai/suggest-slots", {
      method: "POST",
      body: JSON.stringify({
        doctorId: args.doctorId,
        symptoms: args.symptoms ?? null,
        daysAhead: args.daysAhead,
      }),
    }),

  /** Admin xem báo cáo chi phí dùng AI (OpenAI) trong khoảng ngày. */
  getAdminAiUsageStats: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const tail = qs.toString() ? `?${qs.toString()}` : "";
    return request<ApiAdminAiUsageStats>(`/admin/ai-usage/stats${tail}`);
  },

  /**
   * Trợ lý AI cho bác sĩ — gửi câu hỏi tự nhiên, AI tra cứu hồ sơ bệnh án
   * (chỉ hồ sơ của bác sĩ đó) và trả lời kèm trích nguồn.
   *
   * @param sessionId Truyền null để tạo session mới; lần sau dùng `result.sessionId`
   *                  để các turn tiếp theo nối vào cùng phiên.
   */
  doctorAiChat: (
    question: string,
    opts?: { patientId?: string | null; sessionId?: string | null },
  ) =>
    request<ApiDoctorChatResult>("/ai/doctor/chat", {
      method: "POST",
      body: JSON.stringify({
        question,
        patientId: opts?.patientId ?? null,
        sessionId: opts?.sessionId ?? null,
      }),
    }),

  /** Liệt kê các phiên chat AI của bác sĩ — sort updatedAt DESC, dùng cho sidebar. */
  listDoctorAiSessions: () =>
    request<ApiDoctorChatSessionListItem[]>("/ai/doctor/sessions"),

  /** Chi tiết 1 phiên + toàn bộ messages — dùng để load lại lịch sử khi click session. */
  getDoctorAiSession: (id: string) =>
    request<ApiDoctorChatSessionDetail>(`/ai/doctor/sessions/${id}`),

  /** Tạo 1 phiên rỗng — title sẽ tự update khi gửi message đầu. */
  createDoctorAiSession: () =>
    request<{
      id: string;
      title: string;
      createdAt: string;
      updatedAt: string;
    }>("/ai/doctor/sessions", { method: "POST", body: JSON.stringify({}) }),

  /** Đổi tên phiên. */
  renameDoctorAiSession: (id: string, title: string) =>
    request<{ id: string; title: string; updatedAt: string }>(
      `/ai/doctor/sessions/${id}`,
      { method: "PATCH", body: JSON.stringify({ title }) },
    ),

  /** Xoá phiên (kèm toàn bộ messages — DB CASCADE). */
  deleteDoctorAiSession: (id: string) =>
    request<{ ok: true }>(`/ai/doctor/sessions/${id}`, { method: "DELETE" }),

  /** Lấy chi tiết 1 hồ sơ bệnh án của bác sĩ — dùng khi click "Xem hồ sơ" từ kết quả AI. */
  getMyDoctorMedicalRecord: (recordId: string) =>
    request<ApiDoctorMedicalRecordListItem>(
      `/medical-records/me/records/${recordId}`,
    ),

  /** Backfill embedding cho mọi hồ sơ chưa có vector (chạy 1 lần khi data cũ). */
  backfillMyMedicalRecordEmbeddings: (opts?: {
    forceAll?: boolean;
    limit?: number;
  }) =>
    request<{
      processed: number;
      succeeded: number;
      failed: number;
      skipped: number;
    }>("/medical-records/me/backfill-embeddings", {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    }),
};

/** Format trả về của AI gợi ý chuyên khoa. */
export interface ApiSpecialtySuggestionItem {
  departmentId: string | null;
  departmentName: string;
  reason: string;
  confidence: "low" | "medium" | "high";
}

export interface ApiSpecialtySuggestion {
  suggestions: ApiSpecialtySuggestionItem[];
  /** Có dấu hiệu cấp cứu — UI nên hiện banner đỏ khuyên đi cấp cứu. */
  urgent: boolean;
  generalNote: string | null;
}

/** 1 slot được gợi ý cho user khi đặt lịch. */
export interface ApiSlotSuggestionItem {
  slotId: string;
  slotTime: string;
  doctorName: string;
  score: number;
  reasons: string[];
}

/** Kết quả AI gợi ý slot. */
export interface ApiSlotSuggestion {
  /** AI đánh giá triệu chứng có cần khám sớm không. */
  urgent: boolean;
  urgencyReason: string | null;
  /** true = có dùng pattern cá nhân (user đã có ≥3 lịch khám trong 6 tháng). */
  personalized: boolean;
  suggestions: ApiSlotSuggestionItem[];
  consideredCount: number;
}

/** Một nguồn (record) mà AI dựa vào để trả lời. patient info là THẬT (bác sĩ là chủ hồ sơ). */
export interface ApiDoctorChatSource {
  index: number;
  recordId: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  patientEmail: string | null;
  appointmentId: string | null;
  slotTime: string | null;
  similarity: number;
  excerpt: string;
}

/** Kết quả chat trợ lý AI cho bác sĩ. */
export interface ApiDoctorChatResult {
  sessionId: string;
  answer: string;
  sources: ApiDoctorChatSource[];
  searchedCount: number;
  promptTokens: number;
  completionTokens: number;
}

/** 1 phiên trong sidebar lịch sử. */
export interface ApiDoctorChatSessionListItem {
  id: string;
  title: string;
  updatedAt: string;
  lastUserMessage: string | null;
  messageCount: number;
}

/** 1 message khi load chi tiết session. */
export interface ApiDoctorChatSessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: ApiDoctorChatSource[] | null;
  createdAt: string;
}

/** Detail của 1 session với toàn bộ messages. */
export interface ApiDoctorChatSessionDetail {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ApiDoctorChatSessionMessage[];
}

/** Báo cáo chi phí dùng AI cho admin. */
export interface ApiAdminAiUsageStats {
  range: { from: string; to: string };
  totals: {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  byFeature: {
    feature: string;
    requests: number;
    totalTokens: number;
    costUsd: number;
  }[];
  byModel: {
    model: string;
    requests: number;
    totalTokens: number;
    costUsd: number;
  }[];
  byDay: {
    date: string;
    requests: number;
    totalTokens: number;
    costUsd: number;
  }[];
}

export type UserRole = "user" | "doctor" | "admin" | "receptionist" | "cashier";

export interface ApiAuthUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role?: UserRole;
  isLocked?: boolean;
  avatarUrl?: string | null;
  departmentId?: string | null;
  bio?: string | null;
  experienceYears?: number | null;
  university?: string | null;
  createdAt?: string;
}

export interface ApiAuthResult {
  access_token: string;
  user: ApiAuthUser;
}

/** POST /auth/register (PB01 — không trả JWT, chỉ thông báo thành công) */
export interface ApiRegisterSuccess {
  message: string;
}

export interface ApiDepartment {
  id: string;
  name: string;
  description: string | null;
}

export interface ApiDoctor {
  id: string;
  departmentId: string | null;
  fullName: string;
  /** Chỉ khi ghép từ admin users / cần cho dashboard quản trị */
  email?: string;
  bio: string | null;
  experienceYears: number | null;
  avatarUrl: string | null;
  createdAt: string;
  department?: ApiDepartment | null;
  university?: string | null;
  schedules?: ApiDoctorSchedule[];
}

export interface ApiDoctorSchedule {
  id: string;
  doctorId: string;
  workDay: string;
  startTime: string;
  endTime: string;
}

export interface ApiCreateDoctorBody {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  departmentId?: string | null;
  bio?: string | null;
  experienceYears?: number | null;
  university?: string | null;
}

/** PATCH /admin/doctors/:id (không gồm mật khẩu) */
export interface ApiUpdateDoctorBody {
  email: string;
  fullName: string;
  phone?: string | null;
  departmentId?: string | null;
  bio?: string | null;
  experienceYears?: number | null;
  university?: string | null;
}

/** Slot đặt lịch (15 phút), T2–T6 08:00–17:00, trừ nghỉ trưa 11:30–13:00 */
export interface ApiAppointmentSlot {
  id: string;
  doctorId: string;
  slotTime: string; // ISO timestamp
  status: "available" | "booked" | "on_leave";
}

/** GET /doctor/me/patients — bệnh nhân đã đặt lịch với bác sĩ */
export interface ApiDoctorPatient {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  totalAppointments: number;
  completedAppointments: number;
  upcomingAppointments: number;
  lastVisitAt: string | null;
  nextAppointmentAt: string | null;
  hasMedicalRecord: boolean;
}

/** GET /doctor/me/appointments — lịch hẹn của bác sĩ trong khoảng ngày */
export interface ApiDoctorAppointment {
  id: string;
  status: string;
  symptoms: string | null;
  depositAmount: number | null;
  createdAt: string;
  slot: { id: string; slotTime: string } | null;
  patient: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    avatarUrl: string | null;
  } | null;
  hasMedicalRecord: boolean;
}

/** Đơn xin nghỉ phép (bác sĩ → admin duyệt) */
/** Lịch chờ bác sĩ nhập hồ sơ sau khi ca đã qua */
export interface ApiDoctorPendingMedicalAppointment {
  id: string;
  patientId: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string | null;
  slotTime: string;
  appointmentSymptoms: string | null;
  status: string;
}

export interface ApiDoctorMedicalRecordListItem {
  version: number;
  id: string;
  patientId: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string | null;
  appointmentId: string | null;
  slotTime: string | null;
  symptoms: string | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
  createdAt: string;
}

/** GET /admin/stats/overview — báo cáo admin */
export interface ApiAdminStatsOverview {
  range: { from: string; to: string };
  totalRevenuePaid: number;
  paymentCounts: { pending: number; paid: number; failed: number };
  appointmentsInRange: number;
  distinctPatientsWithAppointmentInRange: number;
  patientAccountsTotal: number;
  newPatientRegistrationsInRange: number;
  revenueByDay: { date: string; total: number }[];
}

/** Quảng cáo (PB38) */
export type AdType = "banner" | "promo";
export type AdStatus = "draft" | "active" | "paused" | "archived" | "expired";
export type AdPlacement =
  | "home_hero"
  | "home_below_search"
  | "doctor_detail"
  | "dashboard_user";

export const AD_TYPES: AdType[] = ["banner", "promo"];
export const AD_STATUSES: AdStatus[] = [
  "draft",
  "active",
  "paused",
  "archived",
  "expired",
];
export const AD_PLACEMENTS: AdPlacement[] = [
  "home_hero",
  "home_below_search",
  "doctor_detail",
  "dashboard_user",
];

export interface ApiAdminAd {
  id: string;
  type: AdType;
  title: string;
  body: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  placements: AdPlacement[];
  status: AdStatus;
  priority: number;
  startAt: string | null;
  endAt: string | null;
  viewCount: number;
  clickCount: number;
  isEffective: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiPublicAd {
  id: string;
  type: AdType;
  title: string;
  body: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  priority: number;
}

/** Body khi tạo / cập nhật quảng cáo (multipart). Field undefined → giữ nguyên. */
export interface ApiAdUpsertBody {
  type?: AdType;
  title?: string;
  body?: string | null;
  linkUrl?: string | null;
  placements?: AdPlacement[];
  status?: AdStatus;
  priority?: number;
  /** ISO chuỗi datetime hoặc rỗng để xóa */
  startAt?: string | null;
  endAt?: string | null;
}

/** GET /admin/payments — một giao dịch */
export interface ApiAdminPaymentRow {
  id: string;
  amount: number;
  paymentType: string | null;
  paymentMethod: string | null;
  status: "pending" | "paid" | "failed";
  createdAt: string;
  payosOrderCode: number | null;
  appointmentId: string;
  appointmentStatus: string;
  patient: { id: string; fullName: string; email: string };
  doctor: { id: string; fullName: string };
  slotTime: string | null;
}

/** GET /medical-records/me/stats — thống kê bệnh án của bác sĩ */
export interface ApiDoctorStats {
  range: { from: string; to: string };
  totalRecords: number;
  totalRecordsAllTime: number;
  uniquePatients: number;
  uniquePatientsAllTime: number;
  pendingCount: number;
  /** 0..1 — số hồ sơ / số ca đủ điều kiện đã qua giờ trong khoảng */
  completionRate: number;
  byDay: { date: string; count: number }[];
  topDiagnoses: { keyword: string; count: number }[];
}

export interface ApiCreateMedicalRecordResult {
  record: {
    id: string;
    patientId: string;
    doctorId: string;
    appointmentId: string | null;
    symptoms: string | null;
    diagnosis: string | null;
    treatment: string | null;
    notes: string | null;
    createdAt: string;
  };
  /** true nếu DB có pgvector + OPENAI_API_KEY và gọi embedding thành công */
  embeddingStored: boolean;
}

export interface ApiDoctorLeaveRequest {
  id: string;
  doctorId: string;
  doctorName: string;
  doctorEmail: string;
  startDate: string;
  endDate: string;
  /** Ngày T2–T6 trong khoảng (không gồm T7/CN); thiếu thì client tự tính */
  workdaysInRange?: string[];
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface ApiCreateAppointmentResult {
  appointment: {
    id: string;
    userId: string;
    doctorId: string;
    slotId: string | null;
    symptoms: string | null;
    status: string;
    depositAmount: number | null;
    createdAt: string;
  };
  payment: {
    id: string;
    appointmentId: string;
    amount: number;
    paymentType: string | null;
    paymentMethod: string | null;
    status: string;
    createdAt: string;
    payosOrderCode: number | null;
  };
  checkoutUrl: string;
}

/** Lịch đã đặt (GET /appointments/me) - có thể kèm doctor + slot */
export interface ApiAppointment {
  id: string;
  userId: string;
  doctorId: string;
  slotId: string | null;
  symptoms: string | null;
  status: string;
  depositAmount: number | null;
  createdAt: string;
  doctor?: {
    fullName: string;
    avatarUrl: string | null;
    departmentName: string | null;
  } | null;
  slot?: { slotTime: string } | null;
  /** Đã có hồ sơ khám tương ứng → bệnh nhân có thể xem kết quả khám. */
  hasMedicalRecord?: boolean;
  /** Lý do huỷ (nếu có). */
  cancelReason?: string | null;
  /** Thời điểm huỷ. */
  cancelledAt?: string | null;
}

/** GET /medical-records/me/patient[*] — hồ sơ khám hiển thị cho bệnh nhân chính chủ. */
export interface ApiPatientMedicalRecord {
  id: string;
  appointmentId: string | null;
  slotTime: string | null;
  doctor: {
    id: string;
    fullName: string;
    avatarUrl: string | null;
    departmentName: string | null;
  } | null;
  symptoms: string | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
  createdAt: string;
}

/** GET /appointments/me/payments — lịch sử giao dịch của bệnh nhân */
export interface ApiPaymentHistoryItem {
  id: string;
  amount: number;
  paymentType: string | null;
  paymentMethod: string | null;
  /** 'pending' | 'paid' | 'failed' */
  status: string;
  createdAt: string;
  payosOrderCode: number | null;
  appointment: {
    id: string;
    /** appointments.status: pending/confirmed/completed/cancelled */
    status: string;
    slotTime: string | null;
    doctor: {
      fullName: string;
      avatarUrl: string | null;
      departmentName: string | null;
    } | null;
  } | null;
}
