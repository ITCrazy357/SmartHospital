import React, { useEffect, useRef, useState } from "react";
import {
  clinicApi,
  type ClinicAccount,
  type ClinicPatient,
  type PatientAccess,
} from "../../api/clinic";
import {
  buttonClass,
  Empty,
  ErrorMessage,
  Field,
  inputClass,
  secondaryClass,
} from "./clinic-ui";

export function ClinicPatientRegistry({ role }: { role: string }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ClinicPatient[]>([]);
  const [selected, setSelected] = useState<ClinicPatient | null>(null);
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    dateOfBirth: "",
    sex: "unspecified",
    address: "",
    allergies: "",
    medicalHistory: "",
    userId: "",
  });
  const [accounts, setAccounts] = useState<ClinicAccount[]>([]);
  const [accountQuery, setAccountQuery] = useState("");
  const [access, setAccess] = useState<PatientAccess[]>([]);
  const [representative, setRepresentative] = useState("");
  const [relationship, setRelationship] = useState("");
  const [checkedRepresentation, setCheckedRepresentation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const selectedRequest = useRef(0);
  const canRegister = ["admin", "receptionist"].includes(role);
  const canEdit = ["admin", "receptionist", "doctor"].includes(role);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    clinicApi
      .patients(query, page)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Không tải được bệnh nhân");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, page, refresh]);
  const select = (p: ClinicPatient | null) => {
    const request = ++selectedRequest.current;
    setSelected(p);
    setError(null);
    setAccess([]);
    setAccounts([]);
    setAccountQuery("");
    setRepresentative("");
    setRelationship("");
    setCheckedRepresentation(false);
    setForm({
      fullName: p?.full_name ?? "",
      phone: p?.phone ?? "",
      dateOfBirth: p?.date_of_birth?.slice(0, 10) ?? "",
      sex: p?.sex ?? "unspecified",
      address: p?.address ?? "",
      allergies: p?.allergies ?? "",
      medicalHistory: p?.medical_history ?? "",
      userId: p?.user_id ?? "",
    });
    if (p && canRegister)
      clinicApi
        .access(p.id)
        .then((rows) => {
          if (request === selectedRequest.current) setAccess(rows);
        })
        .catch((e) => {
          if (request === selectedRequest.current)
            setError(
              e instanceof Error ? e.message : "Không tải được người đại diện",
            );
        });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body =
        role === "doctor"
          ? {
              allergies: form.allergies,
              medicalHistory: form.medicalHistory,
              version: selected?.version,
            }
          : {
              fullName: form.fullName,
              phone: form.phone,
              dateOfBirth: form.dateOfBirth || null,
              sex: form.sex,
              address: form.address,
              userId: form.userId || null,
              version: selected?.version,
              ...(role === "admin" && selected
                ? {
                    allergies: form.allergies,
                    medicalHistory: form.medicalHistory,
                  }
                : {}),
            };
      const saved = selected
        ? await clinicApi.updatePatient(selected.id, body)
        : await clinicApi.createPatient(body);
      select(saved);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được bệnh nhân");
    } finally {
      setBusy(false);
    }
  };
  const searchAccounts = async () => {
    setError(null);
    try {
      setAccounts(await clinicApi.accounts(accountQuery));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tìm được tài khoản");
    }
  };
  return (
    <div className="space-y-4">
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Tìm bệnh nhân"
          className={`${inputClass} flex-1 min-w-48`}
          placeholder="Tìm họ tên, mã bệnh nhân, số điện thoại"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        {canRegister && (
          <button className={buttonClass} onClick={() => select(null)}>
            Đăng ký bệnh nhân
          </button>
        )}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-2" aria-busy={busy}>
          {!rows.length ? (
            <Empty>{busy ? "Đang tải…" : "Không tìm thấy bệnh nhân."}</Empty>
          ) : (
            rows.map((p) => (
              <button
                key={p.id}
                className={`w-full rounded-xl border p-3 text-left ${selected?.id === p.id ? "border-primary bg-primary/5" : "border-slate-200 bg-white"}`}
                onClick={() => select(p)}
              >
                <strong>{p.full_name}</strong>
                <p className="text-sm text-slate-600">
                  {p.patient_code} · {p.phone || "Chưa có SĐT"}
                </p>
              </button>
            ))
          )}
          <div className="flex items-center justify-between gap-3">
            <button
              className={secondaryClass}
              disabled={page <= 1 || busy}
              onClick={() => setPage((p) => p - 1)}
            >
              Trước
            </button>
            <span className="text-sm">Trang {page}</span>
            <button
              className={secondaryClass}
              disabled={busy || page * 30 >= (rows[0]?.total ?? 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau
            </button>
          </div>
        </section>
        <section className="space-y-4">
          {(selected || canRegister) && (
            <form
              onSubmit={save}
              className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <h3 className="font-bold">
                {selected
                  ? `${selected.patient_code} — ${selected.full_name}`
                  : "Bệnh nhân mới"}
              </h3>
              <Field label="Họ tên">
                <input
                  required
                  maxLength={255}
                  className={inputClass}
                  value={form.fullName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fullName: e.target.value }))
                  }
                  disabled={!canRegister || busy}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Ngày sinh">
                  <input
                    type="date"
                    className={inputClass}
                    value={form.dateOfBirth}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, dateOfBirth: e.target.value }))
                    }
                    disabled={!canRegister || busy}
                  />
                </Field>
                <Field label="Giới tính">
                  <select
                    className={inputClass}
                    value={form.sex}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, sex: e.target.value }))
                    }
                    disabled={!canRegister || busy}
                  >
                    <option value="unspecified">Chưa cung cấp</option>
                    <option value="female">Nữ</option>
                    <option value="male">Nam</option>
                    <option value="other">Khác</option>
                  </select>
                </Field>
              </div>
              <Field label="Số điện thoại">
                <input
                  maxLength={50}
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  disabled={!canRegister || busy}
                />
              </Field>
              <Field label="Địa chỉ">
                <input
                  maxLength={1000}
                  className={inputClass}
                  value={form.address}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, address: e.target.value }))
                  }
                  disabled={!canRegister || busy}
                />
              </Field>
              {["doctor", "admin", "user"].includes(role) && (
                <>
                  <Field label="Dị ứng">
                    <textarea
                      maxLength={4000}
                      className={inputClass}
                      value={form.allergies}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, allergies: e.target.value }))
                      }
                      disabled={!canEdit || !selected || busy}
                    />
                  </Field>
                  <Field label="Tiền sử">
                    <textarea
                      maxLength={4000}
                      className={inputClass}
                      value={form.medicalHistory}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          medicalHistory: e.target.value,
                        }))
                      }
                      disabled={!canEdit || !selected || busy}
                    />
                  </Field>
                </>
              )}
              {canRegister && !selected && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm text-slate-600">
                    Liên kết tài khoản bệnh nhân nếu đã đăng ký; có thể để trống
                    cho người đến quầy.
                  </p>
                  <div className="flex gap-2">
                    <input
                      aria-label="Tìm tài khoản bệnh nhân"
                      className={inputClass}
                      value={accountQuery}
                      onChange={(e) => setAccountQuery(e.target.value)}
                      placeholder="Email, họ tên hoặc SĐT (tối thiểu 3 ký tự)"
                    />
                    <button
                      type="button"
                      className={secondaryClass}
                      disabled={accountQuery.trim().length < 3 || busy}
                      onClick={() => void searchAccounts()}
                    >
                      Tìm
                    </button>
                  </div>
                  <Field label="Tài khoản bệnh nhân">
                    <select
                      className={inputClass}
                      value={form.userId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, userId: e.target.value }))
                      }
                    >
                      <option value="">Chưa liên kết</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.full_name} · {a.email}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              {canEdit && (selected || canRegister) && (
                <button
                  className={buttonClass}
                  disabled={busy || !form.fullName.trim()}
                >
                  {busy
                    ? "Đang lưu…"
                    : selected
                      ? "Lưu cập nhật"
                      : "Tạo mã bệnh nhân"}
                </button>
              )}
            </form>
          )}
          {selected && canRegister && (
            <section className="space-y-3 rounded-2xl border p-4">
              <h3 className="font-bold">Người đại diện / đặt thay</h3>
              <p className="text-sm text-slate-600">
                Người được cấp quyền có thể xem hồ sơ khám đã xác nhận của bệnh
                nhân này. Chỉ cấp sau khi kiểm tra quyền đại diện.
              </p>
              {access.map((a) => (
                <div
                  key={a.user_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm"
                >
                  <p>
                    {a.full_name} · {a.email}
                    <br />
                    Quan hệ: {a.relationship}
                  </p>
                  <button
                    className={secondaryClass}
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "Thu hồi quyền truy cập của người đại diện này?",
                        )
                      )
                        return;
                      setBusy(true);
                      try {
                        await clinicApi.revokeAccess(selected.id, a.user_id);
                        setAccess(await clinicApi.access(selected.id));
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : "Không thu hồi được",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Thu hồi
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  aria-label="Tìm người đại diện"
                  className={inputClass}
                  value={accountQuery}
                  onChange={(e) => setAccountQuery(e.target.value)}
                  placeholder="Tìm tài khoản người đại diện"
                />
                <button
                  className={secondaryClass}
                  disabled={busy || accountQuery.trim().length < 3}
                  onClick={() => void searchAccounts()}
                >
                  Tìm
                </button>
              </div>
              <Field label="Tài khoản đại diện">
                <select
                  className={inputClass}
                  value={representative}
                  onChange={(e) => setRepresentative(e.target.value)}
                >
                  <option value="">Chọn tài khoản</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name} · {a.email}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quan hệ với bệnh nhân">
                <input
                  maxLength={40}
                  className={inputClass}
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  placeholder="Cha/mẹ, người giám hộ…"
                />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checkedRepresentation}
                  onChange={(e) => setCheckedRepresentation(e.target.checked)}
                />
                Đã kiểm tra danh tính và căn cứ đại diện của người được cấp
                quyền.
              </label>
              <button
                className={buttonClass}
                disabled={
                  busy ||
                  !representative ||
                  !relationship.trim() ||
                  !checkedRepresentation
                }
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await clinicApi.grantAccess(selected.id, {
                      userId: representative,
                      relationship,
                      confirmed: true,
                    });
                    setAccess(await clinicApi.access(selected.id));
                    setCheckedRepresentation(false);
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Không cấp quyền được",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Cấp quyền đã xác minh
              </button>
            </section>
          )}
        </section>
      </div>
    </div>
  );
}
