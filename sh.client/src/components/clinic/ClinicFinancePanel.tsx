import React, { useState } from "react";
import { clinicApi, type ClinicDetail } from "../../api/clinic";
import {
  amountVN,
  buttonClass,
  dateVN,
  ErrorMessage,
  Field,
  inputClass,
  labelStatus,
  printClinic,
  printableStyle,
  secondaryClass,
} from "./clinic-ui";

const kindLabel = (kind: string) =>
  ({
    deposit: "Cọc trực tuyến",
    collection: "Thu phí",
    refund: "Hoàn tiền",
    transfer_in: "Nhận chuyển cọc",
    transfer_out: "Chuyển cọc",
  })[kind] ?? kind;
export function ClinicFinancePanel({
  detail,
  userId,
  role,
  onSaved,
}: {
  detail: ClinicDetail;
  userId: string;
  role: string;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [transferId, setTransferId] = useState("");
  const [targets, setTargets] = useState<{ id: string; title: string }[]>([]);
  const [targetDay, setTargetDay] = useState(
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptKey] = useState(() => crypto.randomUUID());
  const [transferKey] = useState(() => crypto.randomUUID());
  const [refundKey] = useState(() => crypto.randomUUID());
  const paid = detail.ledger.reduce((sum, row) => sum + Number(row.amount), 0);
  const fee = Number(detail.visit.consultation_fee);
  const remaining = ["cancelled", "no_show"].includes(detail.visit.status)
    ? 0
    : Math.max(0, fee - paid);
  const canWrite = role === "cashier" || role === "admin";
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thực hiện được thao tác",
      );
    } finally {
      setBusy(false);
    }
  };
  const collect = () => {
    if (
      !window.confirm(`Xác nhận đã nhận thực tế ${amountVN(Number(amount))}?`)
    )
      return;
    void run(() =>
      clinicApi.collect(detail.visit.id, {
        amount: Number(amount),
        method,
        reference: reference.trim() || null,
        confirmed: true,
        idempotencyKey: receiptKey,
      }),
    );
  };
  const refund = () => {
    if (
      !window.confirm(
        `Gửi đề nghị hoàn ${amountVN(Number(amount))} cho quản trị xét duyệt? Thao tác này chưa chuyển tiền.`,
      )
    )
      return;
    void run(() =>
      clinicApi.refund(detail.visit.id, {
        amount: Number(amount),
        reason,
        idempotencyKey: refundKey,
      }),
    );
  };
  const review = (id: string, approve: boolean) => {
    if (!reason.trim()) {
      setError("Nhập ý kiến duyệt trong ô lý do bên dưới.");
      return;
    }
    if (
      !window.confirm(
        approve
          ? "Duyệt đề nghị? Thu ngân sẽ xác nhận riêng sau khi chi hoàn thực tế."
          : "Từ chối đề nghị hoàn?",
      )
    )
      return;
    void run(() => clinicApi.reviewRefund(id, { approve, note: reason }));
  };
  const pay = (id: string) => {
    if (!reference.trim()) {
      setError("Nhập chứng từ hoàn tiền vào ô mã giao dịch.");
      return;
    }
    if (
      !window.confirm(
        "Xác nhận tiền đã được hoàn thực tế, đúng bệnh nhân và đúng số tiền đã duyệt?",
      )
    )
      return;
    void run(() => clinicApi.payRefund(id, { reference, confirmed: true }));
  };
  return (
    <section className="space-y-4">
      <ErrorMessage message={error} />
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-xl bg-slate-50 p-3">
          Phí khám<strong className="block">{amountVN(fee)}</strong>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          Đã ghi nhận<strong className="block">{amountVN(paid)}</strong>
        </div>
        <div className="rounded-xl bg-amber-50 p-3">
          Còn phải thu<strong className="block">{amountVN(remaining)}</strong>
        </div>
      </div>
      {canWrite && (
        <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
          <h3 className="font-bold">Ghi nhận thu / đề nghị hoàn</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Số tiền (VND)">
              <input
                type="number"
                step="1"
                min="1"
                max="1000000000"
                className={inputClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy}
              />
            </Field>
            <Field label="Hình thức thu">
              <select
                className={inputClass}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                disabled={busy}
              >
                <option value="cash">Tiền mặt</option>
                <option value="bank">Chuyển khoản đã kiểm tra</option>
              </select>
            </Field>
          </div>
          <Field label="Mã giao dịch / chứng từ hoàn tiền">
            <input
              maxLength={200}
              className={inputClass}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="Lý do đề nghị / ý kiến duyệt">
            <textarea
              maxLength={1000}
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button
              className={buttonClass}
              onClick={collect}
              disabled={
                busy ||
                Number(amount) <= 0 ||
                Number(amount) > remaining ||
                (method === "bank" && !reference.trim()) ||
                ["cancelled", "no_show"].includes(detail.visit.status)
              }
            >
              Xác nhận đã thu tiền
            </button>
            <button
              className={secondaryClass}
              onClick={refund}
              disabled={busy || Number(amount) <= 0 || !reason.trim()}
            >
              Gửi đề nghị hoàn
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Các thao tác ghi nhận tiền đã giao nhận; ứng dụng không tự chuyển
            tiền từ tài khoản ngân hàng.
          </p>
        </div>
      )}
      {detail.refunds.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-bold">Đề nghị hoàn</h3>
          {detail.refunds.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-slate-200 p-3 text-sm"
            >
              <strong>
                {amountVN(r.amount)} · {labelStatus(r.status)}
              </strong>
              <p>{r.reason}</p>
              {r.review_note && <p>Ý kiến: {r.review_note}</p>}
              {r.payment_reference && <p>Chứng từ: {r.payment_reference}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {role === "admin" && r.status === "pending" && (
                  <>
                    <button
                      className={buttonClass}
                      disabled={busy || r.requested_by === userId}
                      onClick={() => review(r.id, true)}
                    >
                      Duyệt
                    </button>
                    <button
                      className={secondaryClass}
                      disabled={busy}
                      onClick={() => review(r.id, false)}
                    >
                      Từ chối
                    </button>
                  </>
                )}
                {canWrite && r.status === "approved" && (
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => pay(r.id)}
                  >
                    Xác nhận đã chi hoàn
                  </button>
                )}
              </div>
              {role === "admin" &&
                r.status === "pending" &&
                r.requested_by === userId && (
                  <p className="mt-2 text-xs text-amber-700">
                    Cần quản trị khác duyệt đề nghị do chính bạn tạo.
                  </p>
                )}
            </div>
          ))}
        </div>
      )}
      {canWrite &&
        ["cancelled", "no_show"].includes(detail.visit.status) &&
        Boolean(detail.reconciliation?.length) && (
          <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h3 className="font-bold">Đối soát cọc của lịch đã hủy</h3>
            {detail.reconciliation!.map((p) => (
              <p key={p.id} className="text-sm break-all">
                {amountVN(p.amount)} ·{" "}
                {p.reconciliation_status === "resolved"
                  ? "Đã đối soát xong"
                  : "Chờ hoàn/chuyển và xác nhận kết quả"}{" "}
                · Mã {p.id}
              </p>
            ))}
            <p className="text-sm">
              Chỉ kết thúc sau khi toàn bộ khoản đã thu được hoàn hoặc chuyển
              sang ca khác, có chứng từ và không còn đề nghị đang chờ.
            </p>
            <button
              className={buttonClass}
              disabled={
                busy ||
                paid !== 0 ||
                !reason.trim() ||
                detail.refunds.some((r) =>
                  ["pending", "approved"].includes(r.status),
                ) ||
                detail.reconciliation!.every(
                  (p) => p.reconciliation_status === "resolved",
                )
              }
              onClick={() => {
                if (
                  window.confirm(
                    "Xác nhận mọi khoản cọc đã được xử lý thực tế và ghi kết quả đối soát?",
                  )
                )
                  void run(() =>
                    clinicApi.resolveReconciliation(detail.visit.id, {
                      confirmed: true,
                      note: reason.trim(),
                    }),
                  );
              }}
            >
              Xác nhận kết thúc đối soát
            </button>
          </section>
        )}
      {canWrite && ["cancelled", "no_show"].includes(detail.visit.status) && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer font-semibold">
            Chuyển khoản đã thu sang ca khác cùng bệnh nhân
          </summary>
          <div className="mt-3 space-y-3">
            <div className="flex gap-2">
              <input
                aria-label="Ngày ca nhận"
                type="date"
                className={inputClass}
                value={targetDay}
                onChange={(e) => setTargetDay(e.target.value)}
              />
              <button
                className={secondaryClass}
                disabled={busy}
                onClick={async () => {
                  setError(null);
                  try {
                    const rows = await clinicApi.visits(targetDay);
                    setTargets(
                      rows
                        .filter(
                          (v) =>
                            v.patient_id === detail.visit.patient_id &&
                            v.id !== detail.visit.id &&
                            !["cancelled", "no_show"].includes(v.status),
                        )
                        .map((v) => ({
                          id: v.id,
                          title: `${dateVN(v.scheduled_at)} · ${v.doctor_name}`,
                        })),
                    );
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Không tải được ca nhận",
                    );
                  }
                }}
              >
                Tìm ca nhận
              </button>
            </div>
            <Field label="Ca nhận">
              <select
                className={inputClass}
                value={transferId}
                onChange={(e) => setTransferId(e.target.value)}
              >
                <option value="">Chọn ca</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-sm text-slate-600">
              Dùng số tiền và lý do đã nhập ở phần thu/hoàn phía trên.
            </p>
            <button
              className={buttonClass}
              disabled={
                busy || !transferId || Number(amount) <= 0 || !reason.trim()
              }
              onClick={() => {
                if (
                  window.confirm(
                    `Chuyển ${amountVN(Number(amount))} sang ca đã chọn?`,
                  )
                )
                  void run(() =>
                    clinicApi.transfer(detail.visit.id, {
                      targetVisitId: transferId,
                      amount: Number(amount),
                      reason,
                      confirmed: true,
                      idempotencyKey: transferKey,
                    }),
                  );
              }}
            >
              Xác nhận chuyển
            </button>
          </div>
        </details>
      )}
      <button className={secondaryClass} onClick={() => printClinic("receipt")}>
        In phiếu thu / chi
      </button>
      {printableStyle()}
      <article className="clinic-print-receipt space-y-3 rounded-2xl border bg-white p-4">
        <h3 className="font-bold">Phiếu ghi nhận thu / chi ca khám</h3>
        <p>
          {detail.patient.full_name} · {detail.patient.patient_code}
        </p>
        <p>
          Ngày khám: {dateVN(detail.visit.scheduled_at)} · Phí khám:{" "}
          {amountVN(fee)}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Thời điểm</th>
                <th className="p-2">Nội dung</th>
                <th className="p-2">Số tiền</th>
                <th className="p-2">Chứng từ</th>
              </tr>
            </thead>
            <tbody>
              {detail.ledger.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-2">{dateVN(row.created_at)}</td>
                  <td className="p-2">
                    {kindLabel(row.kind)}
                    <br />
                    <span className="text-xs">{row.method}</span>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {amountVN(row.amount)}
                  </td>
                  <td className="p-2 break-all">
                    {row.reference || "Tiền mặt"}
                    <br />
                    <span className="text-xs text-slate-500">{row.id}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="font-bold">
          Tổng đã ghi nhận: {amountVN(paid)} · Còn phải thu:{" "}
          {amountVN(remaining)}
        </p>
      </article>
    </section>
  );
}
