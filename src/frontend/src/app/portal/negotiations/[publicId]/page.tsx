"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface NegotiationLine {
  id: number;
  product_id: number;
  product_name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  applied_discount_pct: number;
  line_total: number;
}

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
  resolved_at: string | null;
  created_at: string;
}

interface PortMessage {
  id: number;
  sender_type: "CUSTOMER" | "SALES";
  body: string;
  created_at: string;
}

interface NegotiationDetail {
  id: number;
  public_id: string;
  quotation_number: string;
  quotation_status: string;
  negotiation_status: string;
  currency_code: string;
  current_total: number;
  requests: NegotiationRequest[];
  messages: PortMessage[];
  lines: NegotiationLine[];
}

const STATUS_BADGE: Record<string, { bg: string; label: string }> = {
  OPEN: { bg: "bg-green-100 text-green-800", label: "Open" },
  CLOSED: { bg: "bg-gray-100 text-gray-700", label: "Closed" },
};

const QUOTATION_BADGE: Record<string, string> = {
  NEGOTIATION: "bg-purple-100 text-purple-800",
  APPROVED: "bg-green-100 text-green-800",
  PENDING_REAPPROVAL: "bg-amber-100 text-amber-800",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-blue-100 text-blue-800",
  REJECTED: "bg-red-100 text-red-800",
};

const REQUEST_STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  SUPERSEDED: "bg-gray-100 text-gray-700",
};

export default function PortalNegotiationPage() {
  const params = useParams();
  const router = useRouter();
  const publicId = String(params.publicId);

  const [neg, setNeg] = useState<NegotiationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Request composer
  const [selectedLine, setSelectedLine] = useState<number>(0);
  const [requestType, setRequestType] = useState<string>("DISCOUNT");
  const [requestedValue, setRequestedValue] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Message composer
  const [chatBody, setChatBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<ApiResponse<NegotiationDetail>>(`/api/v1/portal/negotiations/${publicId}`);
      setNeg(res.data);
      setSelectedLine(res.data.lines[0]?.id ?? 0);
    } catch (err: any) {
      setError(err.message || "Failed to load negotiation");
    } finally {
      setLoading(false);
    }
  }, [publicId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!neg) return;
    const lineId = requestType === "DELIVERY_DATE" ? null : selectedLine;
    setSubmitting(true);
    try {
      await api.post(`/api/v1/portal/negotiations/${publicId}/requests`, {
        request_type: requestType,
        quotation_line_id: lineId,
        requested_value: requestedValue,
        message: message || undefined,
      });
      setRequestedValue("");
      setMessage("");
      await load();
    } catch (err: any) {
      alert(err.message || "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatBody.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/v1/portal/negotiations/${publicId}/messages`, { body: chatBody });
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
        <button onClick={() => router.push("/portal")} className="text-sm text-blue-600 font-semibold">
          &larr; Back to portal
        </button>
      </div>
    );
  }

  const negotiationBadge = STATUS_BADGE[neg.negotiation_status] || STATUS_BADGE.OPEN;
  const quotationBadge = QUOTATION_BADGE[neg.quotation_status] || "bg-gray-100 text-gray-700";

  return (
    <div className="w-full space-y-4">
      <button onClick={() => router.push("/portal")} className="text-xs text-blue-600 font-semibold">
        &larr; Back to my quotes
      </button>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Negotiate Quotation</h1>
            <p className="text-sm text-gray-500 mt-1">
              <span className="font-mono font-bold text-blue-700">{neg.quotation_number}</span>
              <span className="mx-2 text-gray-300">|</span>
              Current total: <span className="font-bold text-gray-900">{neg.currency_code} {Number(neg.current_total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <span className={`px-3 py-1 text-xs font-bold rounded-full ${negotiationBadge.bg}`}>{negotiationBadge.label}</span>
            <span className={`px-3 py-1 text-xs font-bold rounded-full ${quotationBadge}`}>{neg.quotation_status}</span>
          </div>
        </div>

        {neg.quotation_status === "PENDING_REAPPROVAL" && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            A discount you requested was accepted and raised the order risk. The quotation has been sent back for a fresh
            internal approval cycle before it can be confirmed.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lines column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Line items */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs">
            <h2 className="font-bold text-gray-900 mb-3">Line Items</h2>
            <div className="space-y-2">
              {neg.lines.map((line) => (
                <div key={line.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 bg-gray-50/60">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-gray-900 truncate">{line.product_name}</div>
                    <div className="text-xs text-gray-500">
                      Qty {line.quantity} × {neg.currency_code} {Number(line.unit_price).toFixed(2)}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Discount applied: <span className="font-semibold text-purple-700">{Number(line.applied_discount_pct).toFixed(2)}%</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-gray-900">{neg.currency_code} {Number(line.line_total).toFixed(2)}</div>
                    <label className="inline-flex items-center gap-1 mt-1 text-[11px] text-gray-500 cursor-pointer">
                      <input
                        type="radio"
                        name="line-select"
                        checked={selectedLine === line.id}
                        onChange={() => setSelectedLine(line.id)}
                        className="accent-purple-600"
                      />
                      target this line
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Request composer */}
          {neg.negotiation_status === "OPEN" && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs">
              <h2 className="font-bold text-gray-900 mb-3">Submit a Negotiation Request</h2>
              <form onSubmit={handleSubmitRequest} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Request Type</label>
                    <select
                      value={requestType}
                      onChange={(e) => {
                        setRequestType(e.target.value);
                        setRequestedValue("");
                      }}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none"
                    >
                      <option value="DISCOUNT">Line Discount (%)</option>
                      <option value="DELIVERY_DATE">Delivery Date</option>
                      <option value="TERMS">Terms</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      {requestType === "DISCOUNT" ? "Requested Discount (%)" : requestType === "DELIVERY_DATE" ? "Requested Date" : "Requested Terms"}
                    </label>
                    <input
                      type="text"
                      required
                      value={requestedValue}
                      onChange={(e) => setRequestedValue(e.target.value)}
                      placeholder={requestType === "DISCOUNT" ? "e.g. 12" : requestType === "DELIVERY_DATE" ? "2026-10-01" : "e.g. NET_60"}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Which Line</label>
                    <select
                      value={selectedLine}
                      disabled={requestType === "DELIVERY_DATE"}
                      onChange={(e) => setSelectedLine(Number(e.target.value))}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none disabled:bg-gray-50"
                    >
                      {neg.lines.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.product_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Optional Note</label>
                  <textarea
                    rows={2}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Add context to help the team respond faster"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
                  >
                    {submitting ? "Submitting..." : "Submit Request"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Right column: requests + messages */}
        <div className="space-y-4">
          {/* Requests history */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs">
            <h2 className="font-bold text-gray-900 mb-3">Requests</h2>
            {neg.requests.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">No requests yet</p>
            ) : (
              <div className="space-y-3">
                {neg.requests.map((r) => (
                  <div key={r.id} className="text-sm border border-gray-100 rounded-lg p-3 bg-gray-50/70">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-gray-800 text-xs">
                        {r.request_type === "DISCOUNT" ? "Discount" : r.request_type === "DELIVERY_DATE" ? "Delivery" : "Terms"}
                        {r.product_name ? ` · ${r.product_name}` : ""}
                      </span>
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${REQUEST_STATUS_BADGE[r.status] || "bg-gray-100 text-gray-700"}`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600">
                      {r.original_value != null ? `${r.original_value}% → ` : ""}
                      <span className="font-bold text-purple-700">{r.requested_value}</span>
                    </div>
                    {r.message && <div className="text-xs text-gray-500 mt-1 italic">“{r.message}”</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Messages thread */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs flex flex-col">
            <h2 className="font-bold text-gray-900 mb-3">Discussion</h2>
            <div className="flex-1 space-y-3 max-h-72 overflow-y-auto pr-1">
              {neg.messages.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">No messages yet</p>
              ) : (
                neg.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] p-3 rounded-lg text-sm ${
                      m.sender_type === "CUSTOMER"
                        ? "bg-purple-600 text-white ml-auto rounded-br-none"
                        : "bg-gray-100 text-gray-800 mr-auto rounded-bl-none"
                    }`}
                  >
                    <div className="text-[10px] opacity-70 mb-0.5">
                      {m.sender_type === "CUSTOMER" ? "You" : "RevSync Sales"}
                    </div>
                    {m.body}
                  </div>
                ))
              )}
            </div>
            {neg.negotiation_status === "OPEN" && (
              <form onSubmit={handleSendMessage} className="mt-3 flex gap-2">
                <input
                  value={chatBody}
                  onChange={(e) => setChatBody(e.target.value)}
                  placeholder="Write a message..."
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
      </div>
    </div>
  );
}