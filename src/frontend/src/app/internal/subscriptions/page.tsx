"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";

interface Subscription {
  id: number;
  public_id: string;
  customer_id: number;
  customer_name: string;
  quotation_id: number | null;
  plan_name: string;
  product_name: string;
  sku: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED";
  quantity: number;
  unit_price: number;
  recurring_amount: number;
  currency: string;
  billing_cycle: "MONTHLY" | "QUARTERLY" | "YEARLY";
  start_date: string;
  current_period_start: string;
  current_period_end: string;
  next_billing_date: string;
  created_at: string;
}

const statusTabs = [
  { label: "All", value: "" },
  { label: "Active", value: "ACTIVE" },
  { label: "Paused", value: "PAUSED" },
  { label: "Cancelled", value: "CANCELLED" },
  { label: "Expired", value: "EXPIRED" },
];

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 border-emerald-300",
  PAUSED: "bg-amber-100 text-amber-800 border-amber-300",
  CANCELLED: "bg-gray-100 text-gray-600 border-gray-300",
  EXPIRED: "bg-rose-100 text-rose-800 border-rose-300",
};

export default function SubscriptionsListPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [billingJobRunning, setBillingJobRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchSubscriptions = async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = { page: page.toString(), limit: "15" };
      if (selectedStatus) params.status = selectedStatus;

      const res = await api.get<ApiResponse<Subscription[]>>("/api/v1/subscriptions", params);
      setSubscriptions(res.data);
      if (res.meta) {
        setTotalPages(res.meta.total_pages);
        setTotal(res.meta.total);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load subscriptions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscriptions();
  }, [page, selectedStatus]);

  const handleRunBillingJob = async () => {
    setBillingJobRunning(true);
    setNotice(null);
    try {
      const res = await api.post<{ message: string; data: { processedSchedules: number; generatedInvoices: number[] } }>(
        "/api/v1/subscriptions/run-billing-job"
      );
      setNotice(
        `Billing job complete! Processed ${res.data.processedSchedules} due schedule(s), generated ${res.data.generatedInvoices.length} recurring invoice(s).`
      );
      fetchSubscriptions();
    } catch (err: any) {
      setError(err.message || "Failed to execute recurring billing job");
    } finally {
      setBillingJobRunning(false);
    }
  };

  const formatCurrency = (amount: number, curr = "USD") => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: curr }).format(amount);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const activeCount = subscriptions.filter((s) => s.status === "ACTIVE").length;
  const mrrTotal = subscriptions
    .filter((s) => s.status === "ACTIVE")
    .reduce((acc, s) => acc + s.recurring_amount, 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Subscription Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time hybrid billing, recurring schedules, proration & credit wallet tracking
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRunBillingJob}
            disabled={billingJobRunning}
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-xs"
          >
            {billingJobRunning ? "Processing Billing Job..." : "⚡ Run Recurring Billing Job"}
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {notice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm flex items-center justify-between shadow-xs">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-600 hover:text-emerald-900 font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm">
          {error}
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-2xs">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Subscriptions</span>
          <div className="text-2xl font-bold text-gray-900 mt-2">{total}</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-2xs">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Accounts</span>
          <div className="text-2xl font-bold text-emerald-600 mt-2">{activeCount}</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-2xs">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Monthly Value</span>
          <div className="text-2xl font-bold text-indigo-600 mt-2">{formatCurrency(mrrTotal)}</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-2xs">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Engine Status</span>
          <div className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1 inline-block mt-2">
            ● Daily Pro-Rata Engine Ready
          </div>
        </div>
      </div>

      {/* Status Filters */}
      <div className="flex items-center space-x-1 border-b border-gray-200 overflow-x-auto pb-1">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setSelectedStatus(tab.value);
              setPage(1);
            }}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
              selectedStatus === tab.value
                ? "bg-white border border-b-0 border-gray-200 text-indigo-600 font-semibold"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table Section */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-2xs">
        {loading ? (
          <div className="p-12 text-center text-gray-400">Loading subscription records...</div>
        ) : subscriptions.length === 0 ? (
          <div className="p-12 text-center text-gray-500 space-y-2">
            <p className="text-base font-semibold">No subscriptions found</p>
            <p className="text-xs text-gray-400">
              Confirm a quotation containing recurring line items to automatically generate subscriptions.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">
                <tr>
                  <th className="px-5 py-3">Subscription</th>
                  <th className="px-5 py-3">Customer</th>
                  <th className="px-5 py-3">Plan / Product</th>
                  <th className="px-5 py-3">Qty</th>
                  <th className="px-5 py-3">Recurring Price</th>
                  <th className="px-5 py-3">Cycle</th>
                  <th className="px-5 py-3">Next Billing</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="px-5 py-4 font-medium text-gray-900">
                      <Link
                        href={`/internal/subscriptions/${sub.id}`}
                        className="text-indigo-600 hover:underline font-mono text-xs font-bold"
                      >
                        SUB-{String(sub.id).padStart(4, "0")}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-gray-700 font-medium">{sub.customer_name}</td>
                    <td className="px-5 py-4 text-gray-800">
                      <div className="font-semibold text-xs">{sub.plan_name}</div>
                      <div className="text-2xs text-gray-400 font-mono">{sub.sku}</div>
                    </td>
                    <td className="px-5 py-4 text-gray-700 font-semibold">{sub.quantity}</td>
                    <td className="px-5 py-4 text-gray-900 font-bold">
                      {formatCurrency(sub.recurring_amount, sub.currency)}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-block px-2.5 py-0.5 text-2xs font-bold rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                        {sub.billing_cycle}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-600 text-xs font-mono">
                      {formatDate(sub.next_billing_date)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-block px-2.5 py-0.5 text-2xs font-bold rounded-full border ${
                          statusStyles[sub.status] || "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/internal/subscriptions/${sub.id}`}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-md transition-colors"
                      >
                        View & Manage →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between text-xs text-gray-600">
            <span>
              Page {page} of {totalPages} ({total} items)
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
