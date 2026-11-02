import React, { useEffect, useState } from "react";
import { request } from "../api/client";
type Policy = {
  enabled: boolean;
  deploymentEnabled: boolean;
  policyVersion: string;
  consented: boolean;
  disclosure: string;
};
export function AiConsentPanel({ admin = false }: { admin?: boolean }) {
  const [policy, setPolicy] = useState<Policy | null>(null),
    [accepted, setAccepted] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request<Policy>("/ai/policy")
      .then(setPolicy)
      .catch((e) => setError(e.message));
  }, []);
  const perform = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      setPolicy(
        await request<Policy>(path, {
          method,
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
      setAccepted(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không cập nhật được quyền AI");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border bg-white p-4 my-3 space-y-3 text-sm">
      <h2 className="font-bold">Quyền sử dụng AI</h2>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {policy && (
        <>
          <p>{policy.disclosure}</p>
          <p>
            AI: {policy.enabled ? "Đang bật" : "Đang tắt"} · Đồng ý của bạn:{" "}
            {policy.consented ? "Có" : "Chưa có"}
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              Tôi đã đọc phạm vi gửi và xử lý dữ liệu ở trên (
              {policy.policyVersion}).
            </span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-lg border p-2"
              disabled={busy || !accepted}
              onClick={() =>
                void perform("/ai/consent", "POST", {
                  accepted: true,
                  policyVersion: policy.policyVersion,
                })
              }
            >
              Đồng ý sử dụng AI
            </button>
            <button
              className="rounded-lg border p-2"
              disabled={busy || !policy.consented}
              onClick={() => void perform("/ai/consent", "DELETE")}
            >
              Thu hồi đồng ý
            </button>
            {admin && (
              <button
                className="rounded-lg border p-2"
                disabled={
                  busy ||
                  (!policy.enabled && (!accepted || !policy.deploymentEnabled))
                }
                onClick={() =>
                  void perform("/ai/policy", "PATCH", {
                    enabled: !policy.enabled,
                    confirmDataProcessing: accepted,
                  })
                }
              >
                {policy.enabled
                  ? "Tắt AI toàn phòng khám"
                  : "Bật AI sau khi duyệt phạm vi dữ liệu"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
