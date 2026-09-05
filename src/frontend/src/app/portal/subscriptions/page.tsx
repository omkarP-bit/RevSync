"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";

interface PortalSubscription {
  id: number;
  public_id: string;
  plan_name: string;
  product_name: string;
  sku: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED";
  quantity: number;
  unit_price: number;
  recurring_amount: number;
  currency: string;
  billing_cycle: string;
  start_date: string;
  current_period_start: string;
  current_period_end: string;
  next_billing_date: string;
}

export default function CustomerPortalSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<PortalSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadSubscriptions() {
      setLoading(true);
      try {
        const res = await api.get<ApiResponse<PortalSubscription[]>>("/api/v1/portal/subscriptions");
        setSubscriptions(res.data);
      } catch (err: any) {
        setError(err.message || "Failed to load subscriptions");
      } finally {
        setLoading(false);
      }
    }
    loadSubscriptions();
  }, []);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Active Subscriptions</h1>
        <p className="text-sm text-gray-500 mt-1">
          View your active recurring services, billing schedules, and current period dates
        </p>
      </div>

      {error && <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm">{error}</div>}

      {loading ? (
        <div className="p-12 text-center text-gray-400">Loading your subscriptions...</div>
      ) : subscriptions.length === 0 ? (
        <div className="p-12 text-center text-gray-500 bg-white border border-gray-200 rounded-xl space-y-2">
          <p className="text-base font-semibold">No active subscriptions found</p>
          <p className="text-xs text-gray-400">
            Subscriptions will appear here automatically once your quotation is confirmed.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {subscriptions.map((sub) => (
            <div key={sub.id} className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4 shadow-2xs">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{sub.plan_name}</h3>
                  <span className="text-xs text-gray-400 font-mono">{sub.sku}</span>
                </div>
                <span
                  className={`px-3 py-1 text-xs font-bold rounded-full border ${
                    sub.status === "ACTIVE"
                      ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                      : "bg-gray-100 text-gray-600 border-gray-300"
                  }`}
                >
                  {sub.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-gray-400">Recurring Price:</span>
                  <div className="text-base font-extrabold text-gray-900">
                    {formatCurrency(sub.recurring_amount, sub.currency)} / {sub.billing_cycle.toLowerCase()}
                  </div>
                  <span className="text-gray-500">Qty: {sub.quantity} seat(s)</span>
                </div>
                <div>
                  <span className="text-gray-400">Next Billing Date:</span>
                  <div className="text-sm font-bold text-indigo-600 font-mono mt-1">
                    {formatDate(sub.next_billing_date)}
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs font-mono flex items-center justify-between text-gray-600">
                <span>Period: {formatDate(sub.current_period_start)}</span>
                <span>→ {formatDate(sub.current_period_end)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
