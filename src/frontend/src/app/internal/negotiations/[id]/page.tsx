"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiResponse } from "@/lib/api";
import { exportNegotiationPdf } from "@/lib/pdf";
import { useCurrency } from "@/components/CurrencyProvider";

interface NegotiationRequest {
  id: number;
  quotation_line_id: number | null;
  product_name: string | null;
  request_type: "DISCOUNT" | "DELIVERY_DATE" | "TERMS";
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "SUPERSEDED";
  original_value: string | null;
  requested_value: string;
  message: string | null;
  requested_by_customer: boolean;
  requested_by: number | null;
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
}

interface NegotiationMessage {
  id: number;
  sender_type: "CUSTOMER" | "SALES";
  sender_user_id: number | null;
  body: string;
  created_at: string;
}

interface NegotiationDetail {
  id: number;
  quotation_id: number;
  public_id: string;
  quotation_number: string;
  customer_id: number;
  customer_name: string;
  currency_code: string;
  grand_total: number;
  quotation_status: string;
  status: string;
  requests: NegotiationRequest[];
  messages: NegotiationMessage[];
}

interface QuotationLine {
  id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  applied_discount_pct: number;
  line_total: number;
}

const REQUEST_TYPE_LABEL: Record<string, string> = {
  DISCOUNT: "Discount",
  DELIVERY_DATE: "Delivery Date",
  TERMS: "Terms",
};

const REQUEST_STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  SUPERSEDED: "bg-gray-100 text-gray-700",
};

export default function NegotiationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const negotiationId = params?.id as string;

  const [neg, setNeg] = useState<NegotiationDetail | null>(null);
  const [lines, setLines] = useState<QuotationLine[]>([]);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [pendingRequest, setPendingRequest] = useState<NegotiationRequest | null>(null);
  const [decision, setDecision] = useState<"accept" | "reject" | null>(null);
  const [notes, setNotes] = useState("");
  const [acting, setActing] = useState(false);

  const [chatBody, setChatBody] = useState("");
  const [sending, setSending] = useState(false);
  const { format } = useCurrency();

  const isManager = roleId === 2 || roleId === 5;

  const load = useCallback(async () => {
    try {
      const res = await api.get<ApiResponse<NegotiationDetail>>(`/api/v1/negotiations/${negotiationId}`);
      setNeg(res.data);
      if (res.data.quotation_id) {
        const linesRes = await api.get<ApiResponse<{ lines: QuotationLine[] }>>(`/api/v1/quotations/${res.data.quotation_id}`);
        setLines(linesRes.data.lines);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load negotiation");
    } finally {
      setLoading(false);
    }
  }, [negotiationId]);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) setRoleId(JSON.parse(stored).role_id);
    load();
  }, [load]);

  const handleDecide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingRequest || !decision) return;
    setActing(true);
    try {
      await api.post(`/api/v1/negotiations/${negotiationId}/requests/${pendingRequest.id}/${decision}`, {
        notes: notes || undefined,
      });
      setPendingRequest(null);
      setDecision(null);
      setNotes("");
      await load();
    } catch (err: any) {
      alert(err.message || "Failed to record decision");
    } finally {
      setActing(false);
    }
  };

  const handleClose = async () => {
    if (!confirm("Close this negotiation? Requests are no longer allowed.")) return;
    try {
      await api.post(`/api/v1/negotiations/${negotiationId}/close`);
      await load();
    } catch (err: any) {
      alert(err.message || "Failed to close negotiation");
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatBody.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/v1/negotiations/${negotiationId}/messages`, { body: chatBody });
      setChatBody("");
      await load();
    } catch (err: any) {
      alert(err.message || "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[50vh]">Loading...</div>;

  if (!neg) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        {error && <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm mb-4">{error}</div>}
        <button onClick={() => router.push("/internal/negotiations")} className="text-sm text-blue-600 font-semibold">
          &larr; Back to negotiations
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-gray-200">
        <div>
          <button onClick={() => router.push("/internal/negotiations")} className="text-xs text-blue-600 font-semibold mb-1">
            &larr; Back to negotiations
          </button>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
            {neg.quotation_number} <span className="text-gray-400 font-medium text-lg">· {neg.customer_name}</span>
          </h1>
          <p className="text-xs text-gray-500">
            Internal negotiation thread · Grand total{" "}
            <span className="font-bold text-gray-900">{format(neg.grand_total)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportNegotiationPdf({ ...neg, lines })}
            className="px-3 py-1 text-xs font-semibold border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            ⬇ Export PDF
          </button>
          <span className={`px-3 py-1 text-xs font-bold rounded-full ${
            neg.status === "OPEN" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
          }`}>
            {neg.status}
          </span>
          <span className={`px-3 py-1 text-xs font-bold rounded-full ${
            neg.quotation_status === "PENDING_REAPPROVAL" || neg.quotation_status === "PENDING_APPROVAL"
              ? "bg-amber-100 text-amber-800"
              : neg.quotation_status === "APPROVED"
              ? "bg-green-100 text-green-800"
              : "bg-purple-100 text-purple-800"
          }`}>
            Quote: {neg.quotation_status}
          </span>
          {isManager && neg.status === "OPEN" && (
            <button onClick={handleClose} className="px-3 py-1 text-xs font-semibold border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
              Close
            </button>
          )}
        </div>
      </div>

      {isManager && neg.quotation_status === "PENDING_REAPPROVAL" && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          A discount accepted in this negotiation pushed risk above threshold and re-triggered the approval workflow.
          The quotation is awaiting a fresh approval cycle before it can be confirmed.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Line items */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-xs overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 font-bold text-gray-900 text-sm">Quotation Lines</div>
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
                <tr>
                  <th className="px-5 py-2 text-left">Product</th>
                  <th className="px-5 py-2 text-right">Qty</th>
                  <th className="px-5 py-2 text-right">Unit Price</th>
                  <th className="px-5 py-2 text-right">Discount</th>
                  <th className="px-5 py-2 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-2 font-semibold text-gray-900">{l.product_name}</td>
                    <td className="px-5 py-2 text-right text-gray-600">{l.quantity}</td>
                    <td className="px-5 py-2 text-right text-gray-600">{format(l.unit_price)}</td>
                    <td className="px-5 py-2 text-right text-sm">
                      <span className={Number(l.applied_discount_pct) > 0 ? "text-purple-700 font-semibold" : "text-gray-400"}>
                        {Number(l.applied_discount_pct).toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-5 py-2 text-right font-extrabold text-gray-900">{format(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Requests */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-xs overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 font-bold text-gray-900 text-sm">Negotiation Requests</div>
            {neg.requests.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">No requests yet</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {neg.requests.map((r) => (
                  <div key={r.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-gray-900 uppercase">{REQUEST_TYPE_LABEL[r.request_type]}</span>
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${REQUEST_STATUS_BADGE[r.status]}`}>
                          {r.status}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {r.requested_by_customer ? "requested by customer" : "requested by sales"}
                        </span>
                      </div>
                      <div className="text-sm mt-1 text-gray-700">
                        {r.product_name && <span className="text-gray-500 mr-2">{r.product_name}:</span>}
                        {r.original_value != null && <span className="text-gray-400 line-through mr-1">{r.original_value}%</span>}
                        <span className="font-bold text-purple-700">{r.requested_value}</span>
                      </div>
                      {r.message && <div className="text-xs text-gray-500 mt-1 italic">“{r.message}”</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.status === "PENDING" && isManager ? (
                        <>
                          <button
                            onClick={() => { setPendingRequest(r); setDecision("accept"); }}
                            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => { setPendingRequest(r); setDecision("reject"); }}
                            className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-50"
                          >
                            Reject
                          </button>
                        </>
                      ) : r.status === "PENDING" ? (
                        <span className="text-[10px] text-gray-400 uppercase font-bold">Awaiting manager</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Messages column */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-xs p-5 flex flex-col">
          <h2 className="font-bold text-gray-900 mb-3 text-sm">Discussion with Customer</h2>
          <div className="flex-1 space-y-3 max-h-96 overflow-y-auto pr-1">
            {neg.messages.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">No messages yet</p>
            ) : (
              neg.messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] p-3 rounded-lg text-sm ${
                    m.sender_type === "SALES"
                      ? "bg-blue-600 text-white ml-auto rounded-br-none"
                      : "bg-gray-100 text-gray-800 mr-auto rounded-bl-none"
                  }`}
                >
                  <div className="text-[10px] opacity-70 mb-0.5">
                    {m.sender_type === "SALES" ? "Our team" : "Customer"}
                  </div>
                  {m.body}
                </div>
              ))
            )}
          </div>
          {neg.status === "OPEN" && (
            <form onSubmit={handleSendMessage} className="mt-3 flex gap-2">
              <input
                value={chatBody}
                onChange={(e) => setChatBody(e.target.value)}
                placeholder="Reply to customer..."
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !chatBody.trim()}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                Send
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Decision modal */}
      {pendingRequest && decision && (
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              {decision === "accept" ? "Accept" : "Reject"} {REQUEST_TYPE_LABEL[pendingRequest.request_type]} Request
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              {pendingRequest.product_name && <span>{pendingRequest.product_name} · </span>}
              Requested value: <span className="font-bold text-purple-700">{pendingRequest.requested_value}</span>
              {pendingRequest.original_value != null && (
                <> (current: <span className="font-mono">{pendingRequest.original_value}%</span>)</>
              )}
            </p>
            <form onSubmit={handleDecide} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  {decision === "accept" ? "Decision Notes" : "Rejection Reason"}
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={decision === "accept" ? "Optional note for the audit trail" : "Explain why this request is rejected"}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none"
                />
              </div>
              {decision === "accept" && pendingRequest.request_type === "DISCOUNT" && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  Accepting a discount applies it to the line and re-runs the approval engine. If risk exceeds the
                  threshold, the quotation is sent back for a fresh approval before it can be confirmed.
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setPendingRequest(null); setDecision(null); setNotes(""); }}
                  className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 font-medium text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={acting}
                  className={`px-4 py-2 text-white rounded text-sm font-semibold disabled:opacity-50 ${
                    decision === "accept" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {acting ? "Saving..." : decision === "accept" ? "Accept Request" : "Reject Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}