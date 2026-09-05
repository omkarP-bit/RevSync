"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiResponse } from "@/lib/api";

interface NegotiationRow {
  id: number;
  quotation_id: number;
  public_id: string;
  quotation_number: string;
  customer_name: string;
  negotiation_status: string;
  quotation_status: string;
  currency_code: string;
  grand_total: number;
  created_at: string;
}

export default function NegotiationsListPage() {
  const router = useRouter();
  const [negotiations, setNegotiations] = useState<NegotiationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [quotationId, setQuotationId] = useState("");
  const [opening, setOpening] = useState(false);

  const fetchNegotiations = async () => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<NegotiationRow[]>>("/api/v1/negotiations", { limit: "100" });
      setNegotiations(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load negotiations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNegotiations();
  }, []);

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quotationId) return;
    setOpening(true);
    try {
      const res = await api.post<ApiResponse<{ id: number }>>("/api/v1/negotiations", { quotation_id: Number(quotationId) });
      setShowModal(false);
      setQuotationId("");
      router.push(`/internal/negotiations/${res.data.id}`);
    } catch (err: any) {
      alert(err.message || "Failed to open negotiation");
    } finally {
      setOpening(false);
    }
  };

  const statusBadge = (s: string) =>
    s === "OPEN"
      ? "bg-green-100 text-green-800"
      : s === "CLOSED"
      ? "bg-gray-100 text-gray-700"
      : "bg-gray-100 text-gray-700";

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Negotiations</h1>
          <p className="text-xs text-gray-500">Customer counter-offers, discount requests and messaging threads.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 text-sm font-semibold shadow-xs"
        >
          + Open Negotiation
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs">{error}</div>}

      <div className="bg-white rounded-lg shadow-xs overflow-hidden border border-gray-200">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading...</div>
        ) : negotiations.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            No negotiations yet. Open one from an approved quotation.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
              <tr>
                <th className="px-6 py-3 text-left">Quotation</th>
                <th className="px-6 py-3 text-left">Customer</th>
                <th className="px-6 py-3 text-left">Quote Status</th>
                <th className="px-6 py-3 text-left">Negotiation</th>
                <th className="px-6 py-3 text-right">Total</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200 text-sm">
              {negotiations.map((n) => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-mono font-bold text-blue-700">{n.quotation_number}</td>
                  <td className="px-6 py-4 font-semibold text-gray-900">{n.customer_name}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-xs font-bold rounded ${
                      n.quotation_status === "PENDING_REAPPROVAL" || n.quotation_status === "PENDING_APPROVAL"
                        ? "bg-amber-100 text-amber-800"
                        : n.quotation_status === "APPROVED"
                        ? "bg-green-100 text-green-800"
                        : n.quotation_status === "CONFIRMED"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-purple-100 text-purple-800"
                    }`}>
                      {n.quotation_status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${statusBadge(n.negotiation_status)}`}>
                      {n.negotiation_status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-extrabold text-gray-900">
                    {n.currency_code} {Number(n.grand_total).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => router.push(`/internal/negotiations/${n.id}`)}
                      className="text-purple-600 hover:text-purple-900 font-semibold text-xs"
                    >
                      Open thread &rarr;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Open Negotiation</h2>
            <form onSubmit={handleOpen} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Quotation ID</label>
                <input
                  type="number"
                  required
                  value={quotationId}
                  onChange={(e) => setQuotationId(e.target.value)}
                  placeholder="e.g. 42"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Only <span className="font-semibold">APPROVED</span> or <span className="font-semibold">NEGOTIATION</span> quotations can be opened.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 font-medium text-gray-700"
                >
                  Cancel
                </button>
                <button type="submit" disabled={opening} className="px-4 py-2 bg-purple-600 text-white rounded text-sm font-semibold hover:bg-purple-700 disabled:opacity-50">
                  {opening ? "Opening..." : "Open Negotiation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}