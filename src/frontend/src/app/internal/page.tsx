"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";
import { useCurrency } from "@/components/CurrencyProvider";

interface Quotation {
  id: number;
  quotation_number: string;
  customer_name: string;
  status: string;
  grand_total: number;
  margin_pct: number;
  created_at: string;
}

export default function InternalDashboard() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const { format, selected, loading: currencyLoading } = useCurrency();

  useEffect(() => {
    async function loadStats() {
      try {
        const res = await api.get<ApiResponse<Quotation[]>>("/api/v1/quotations", { limit: "50" });
        setQuotations(res.data);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  const openQuotes = quotations.filter((q) => q.status === "DRAFT" || q.status === "PENDING_APPROVAL");
  const pendingApprovals = quotations.filter((q) => q.status === "PENDING_APPROVAL");
  const totalPipelineValue = openQuotes.reduce((acc, q) => acc + Number(q.grand_total || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Dashboard</h1>
          <p className="text-sm text-gray-500">Overview of quotations, pending approvals, and pipeline performance.</p>
        </div>
        <Link
          href="/internal/quotations"
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
        >
          + Create / View Quotations
        </Link>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pending Approvals</h3>
          <p className="text-3xl font-bold text-yellow-600 mt-2">
            {loading ? "..." : pendingApprovals.length}
          </p>
          <span className="text-xs text-gray-400 mt-1 block">Awaiting manager review</span>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Open Quotations</h3>
          <p className="text-3xl font-bold text-blue-600 mt-2">
            {loading ? "..." : openQuotes.length}
          </p>
          <span className="text-xs text-gray-400 mt-1 block">Active drafts & pending</span>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Open Pipeline Value</h3>
          <p className="text-3xl font-bold text-green-600 mt-2">
            {loading || currencyLoading ? "..." : format(totalPipelineValue)}
          </p>
          <span className="text-xs text-gray-400 mt-1 block">Total unconfirmed deal value</span>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">At-Risk Deals</h3>
          <p className="text-3xl font-bold text-red-600 mt-2">0</p>
          <span className="text-xs text-gray-400 mt-1 block">Deal health signals (Phase 9)</span>
        </div>
      </div>

      {/* Recent Activity Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-900">Recent Quotations</h2>
          <Link href="/internal/quotations" className="text-xs text-blue-600 font-medium hover:underline">
            View All Quotes →
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Quote #</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Grand Total</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Margin %</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                    Loading dashboard quotes...
                  </td>
                </tr>
              ) : quotations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                    No quotations created yet. Click &quot;+ Create / View Quotations&quot; to get started.
                  </td>
                </tr>
              ) : (
                quotations.slice(0, 5).map((q) => (
                  <tr key={q.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-bold text-blue-700">{q.quotation_number}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{q.customer_name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 text-xs font-semibold rounded ${
                          q.status === "APPROVED"
                            ? "bg-green-100 text-green-800"
                            : q.status === "PENDING_APPROVAL"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {q.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">
                      {format(Number(q.grand_total) || 0)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-blue-700">
                      {Number(q.margin_pct).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/internal/quotations/${q.id}`}
                        className="text-blue-600 hover:text-blue-900 font-medium"
                      >
                        Open Editor →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
