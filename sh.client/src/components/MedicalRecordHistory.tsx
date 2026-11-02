import React, { useEffect, useState } from "react";
import { request } from "../api/client";
type Revision = {
  version: number;
  reason: string;
  actor_name: string;
  created_at: string;
  snapshot: { diagnosis?: string; treatment?: string; notes?: string };
};
export function MedicalRecordHistory({ recordId }: { recordId: string }) {
  const [rows, setRows] = useState<Revision[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request<Revision[]>(`/medical-records/me/records/${recordId}/revisions`)
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [recordId]);
  return (
    <details className="mt-4 rounded-lg border p-3">
      <summary className="cursor-pointer font-medium">
        Lịch sử chỉnh sửa
      </summary>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {rows.map((r) => (
        <article key={r.version} className="border-b py-3 text-sm">
          <p>
            Phiên bản {r.version} · {r.actor_name} ·{" "}
            {new Date(r.created_at).toLocaleString("vi-VN")}
          </p>
          <p>{r.reason}</p>
          <p className="whitespace-pre-wrap">{r.snapshot.diagnosis}</p>
          <p className="whitespace-pre-wrap">{r.snapshot.treatment}</p>
        </article>
      ))}
    </details>
  );
}
