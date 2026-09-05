"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";
import Link from "next/link";

interface DashboardData {
  customer: {
    id: number;
    name: string;
    company: string | null;
    currency_code: string;
    tier_name: string;
  };
  metrics: {
    total_quotations: number;
    active_quotations: number;
    pending_confirmations: number;
    unpaid_invoices_count: number;
    unpaid_balance_total: number;
    active_subscriptions_count: number;
    mrr_total: number;
    wallet_balance: number;
  };
  recent_quotations: Array<{
    id: number;
    public_id: string;
    quotation_number: string;
    status: string;
    revision_number: number;
    grand_total: number;
    valid_until: string | null;
    created_at: string;
  }>;
}

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "bg-blue-100 text-blue-800",
  SENT: "bg-indigo-100 text-indigo-800",
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
  EXPIRED: "bg-gray-100 text-gray-700",
  DRAFT: "bg-amber-100 text-amber-800",
};

export default function CustomerDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    try {
      const res = await api.get<ApiResponse<DashboardData>>("/api/v1/portal/dashboard");
      setData(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load customer dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loading) {
    return <div className="p-12 text-center text-sm text-gray-500">Loading your account metrics...</div>;
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold">
        {error || "Failed to load account metrics."}
      </div>
    );
  }

  const { customer, metrics, recent_quotations } = data;
  const currency = customer.currency_code || "USD";

  return (
    <div className="w-full space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">
            Welcome back, {customer.name}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {customer.company ? `${customer.company} • ` : ""}{customer.tier_name} Tier • Billing Currency: {currency}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/portal/quotations"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors"
          >
            View All Quotations
          </Link>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
            <span>Pending Confirmations</span>
            <span className="p-1 bg-amber-50 text-amber-600 rounded-lg text-xs font-bold">Quotes</span>
          </div>
          <p className="text-2xl font-extrabold text-gray-900">{metrics.pending_confirmations}</p>
          <p className="text-[11px] text-gray-400 font-medium">Ready for your confirmation</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
            <span>Unpaid Invoices</span>
            <span className="p-1 bg-red-50 text-red-600 rounded-lg text-xs font-bold">Billing</span>
          </div>
          <p className="text-2xl font-extrabold text-red-600">
            {currency} {Number(metrics.unpaid_balance_total).toFixed(2)}
          </p>
          <p className="text-[11px] font-medium text-gray-400">{metrics.unpaid_invoices_count} unpaid invoice(s)</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
            <span>Active Subscriptions</span>
            <span className="p-1 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold">Recurring</span>
          </div>
          <p className="text-2xl font-extrabold text-indigo-600">
            {currency} {Number(metrics.mrr_total).toFixed(2)} / mo
          </p>
          <p className="text-[11px] font-medium text-gray-400">{metrics.active_subscriptions_count} active subscription(s)</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
            <span>Credit Wallet</span>
            <span className="p-1 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold">Credits</span>
          </div>
          <p className="text-2xl font-extrabold text-emerald-600">
            {currency} {Number(metrics.wallet_balance).toFixed(2)}
          </p>
          <p className="text-[11px] font-medium text-gray-400">Available credit balance</p>
        </div>
      </div>

      {/* Recent Quotations Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">Recent Quotations</h2>
          <Link href="/portal/quotations" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">
            View All &rarr;
          </Link>
        </div>

        {recent_quotations.length === 0 ? (
          <div className="p-12 text-center text-xs text-gray-400">No active quotations yet.</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase font-semibold">
              <tr>
                <th className="px-6 py-3 text-left">Quote #</th>
                <th className="px-6 py-3 text-left">Revision</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-right">Grand Total</th>
                <th className="px-6 py-3 text-right">Valid Until</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100 text-xs font-medium">
              {recent_quotations.map((q) => (
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
                  <td className="px-6 py-4 text-right font-extrabold text-gray-900">
                    {currency} {Number(q.grand_total).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-500">
                    {q.valid_until ? new Date(q.valid_until).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-indigo-600 font-bold text-xs hover:underline">
                      View Details &rarr;
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}