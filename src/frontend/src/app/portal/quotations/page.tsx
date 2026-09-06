"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface PortalQuotation {
  id: number;
  public_id: string;
  quotation_number: string;
  revision_number: number;
  currency_code: string;
  status: string;
  payment_terms: string;
  tax_rate_pct: number;
  subtotal: number;
  discount_total: number;
  grand_total: number;
  valid_until: string | null;
  confirmed_at: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "bg-blue-100 text-blue-800",
  SENT: "bg-indigo-100 text-indigo-800",
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
  EXPIRED: "bg-gray-100 text-gray-700",
  DRAFT: "bg-amber-100 text-amber-800",
  PENDING_INTERNAL_APPROVAL: "bg-purple-100 text-purple-800",
};

export default function CustomerQuotationsPage() {
  const router = useRouter();
  const [quotations, setQuotations] = useState<PortalQuotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const loadQuotations = useCallback(async (p = page) => {
    try {
      const res = await api.get<ApiResponse<PortalQuotation[]>>("/api/v1/portal/quotations", {
        page: p.toString(),
        limit: "10",
      });
      setQuotations(res.data);
      if (res.meta) {
        setTotalPages(res.meta.total_pages);
        setTotal(res.meta.total);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load quotations");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadQuotations(page);
  }, [page, loadQuotations]);

  const filtered = statusFilter === "ALL"
    ? quotations
    : quotations.filter((q) => q.status === statusFilter);

  return (
    <div className="w-full space-y-4">
      <div className="pb-2 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Quotations Directory</h1>
          <p className="text-xs text-gray-500">View, negotiate, and confirm all your proposals from RevSync.</p>
        </div>

        <div className="flex items-center space-x-2">
          <label className="text-xs font-semibold text-gray-600">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="APPROVED">APPROVED</option>
            <option value="SENT">SENT</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="EXPIRED">EXPIRED</option>
          </select>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs">{error}</div>}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading quotations...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            No quotations found matching your filter.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase font-semibold">
              <tr>
                <th className="px-6 py-3 text-left">Quote #</th>
                <th className="px-6 py-3 text-left">Revision</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-left">Payment Terms</th>
                <th className="px-6 py-3 text-right">Grand Total</th>
                <th className="px-6 py-3 text-right">Valid Until</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100 text-xs font-medium">
              {filtered.map((q) => (
                <tr
                  key={q.public_id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/portal/quotations/${q.public_id}`)}
                >
                  <td className="px-6 py-4 font-mono font-bold text-indigo-600">{q.quotation_number}</td>
                  <td className="px-6 py-4 text-gray-500">v{q.revision_number}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full ${STATUS_BADGE[q.status] || "bg-gray-100 text-gray-700"}`}>
                      {q.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{q.payment_terms}</td>
                  <td className="px-6 py-4 text-right font-extrabold text-gray-900">
                    {q.currency_code} {Number(q.grand_total).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-500">
                    {q.valid_until ? new Date(q.valid_until).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-indigo-600 font-bold text-xs hover:underline">
                      View Proposal &rarr;
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Controls */}
      <div className="flex justify-between items-center text-xs text-gray-500 pt-2">
        <span>
          Page {page} of {totalPages} ({total} total quotations)
        </span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 border border-gray-300 rounded bg-white font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
          >
            Previous
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 border border-gray-300 rounded bg-white font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
