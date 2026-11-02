import React from "react";
export const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-100";
export const buttonClass =
  "rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed";
export const secondaryClass =
  "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";
export const dangerClass =
  "rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50";
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
export function Empty({
  children = "Chưa có dữ liệu.",
}: {
  children?: React.ReactNode;
}) {
  return (
    <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
      {children}
    </p>
  );
}
export function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
    >
      {message}
    </p>
  ) : null;
}
export const dateVN = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    : "—";
export const dayVN = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
export const amountVN = (n: number | string) =>
  `${Number(n).toLocaleString("vi-VN")} đ`;
export const labelStatus = (value: string) =>
  ({
    scheduled: "Đã đăng ký",
    checked_in: "Chờ khám",
    in_consultation: "Đang khám",
    completed: "Hoàn tất",
    no_show: "Vắng mặt",
    cancelled: "Đã hủy",
    draft: "Bản nháp",
    final: "Đã xác nhận",
    pending: "Chờ duyệt",
    approved: "Đã duyệt, chờ chi",
    rejected: "Từ chối",
    paid: "Đã chi hoàn",
    waiting: "Đang chờ",
    offered: "Đã đề nghị giờ",
    confirmed: "Đã đồng ý giờ",
  })[value] ?? value;
export function printClinic(kind: "encounter" | "receipt") {
  document.body.dataset.clinicPrint = kind;
  window.print();
  delete document.body.dataset.clinicPrint;
}
export function printableStyle() {
  return (
    <style>{`@media print { body * { visibility:hidden !important; } body[data-clinic-print='encounter'] .clinic-print-encounter,body[data-clinic-print='encounter'] .clinic-print-encounter *,body[data-clinic-print='receipt'] .clinic-print-receipt,body[data-clinic-print='receipt'] .clinic-print-receipt * { visibility:visible !important; } body[data-clinic-print='encounter'] .clinic-print-encounter,body[data-clinic-print='receipt'] .clinic-print-receipt { position:absolute;left:0;top:0;width:100%;padding:24px;background:white; } .clinic-no-print { display:none !important; } }`}</style>
  );
}
