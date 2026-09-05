"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";
import { exportSubscriptionPdf } from "@/lib/pdf";
import { useCurrency } from "@/components/CurrencyProvider";

interface Plan {
  id: number;
  name: string;
  price: number;
  billing_cycle: string;
}

interface Schedule {
  id: number;
  billing_date: string;
  period_start: string;
  period_end: string;
  amount: number;
  status: string;
  invoice_id: number | null;
  invoice_number?: string;
}

interface ChangeHistory {
  id: number;
  change_type: string;
  old_plan_name?: string;
  new_plan_name?: string;
  old_quantity: number;
  new_quantity: number;
  effective_date: string;
  old_period_value: number;
  new_period_value: number;
  remaining_days: number;
  period_days: number;
  proration_amount: number;
  created_at: string;
}

interface InvoiceSummary {
  id: number;
  invoice_number: string;
  invoice_type: string;
  status: string;
  grand_total: number;
  wallet_offset_amount: number;
  total_paid: number;
  balance_due: number;
  issue_date: string;
  due_date: string;
}

interface SubscriptionDetail {
  id: number;
  public_id: string;
  customer_id: number;
  customer_name: string;
  customer_email: string;
  quotation_id: number | null;
  quotation_number?: string;
  subscription_plan_id: number | null;
  plan_name: string;
  product_id: number;
  product_name: string;
  sku: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED";
  quantity: number;
  unit_price: number;
  recurring_amount: number;
  currency: string;
  billing_cycle: "MONTHLY" | "QUARTERLY" | "YEARLY";
  start_date: string;
  end_date?: string;
  current_period_start: string;
  current_period_end: string;
  next_billing_date: string;
  wallet_balance: number;
  schedules: Schedule[];
  history: ChangeHistory[];
  invoices: InvoiceSummary[];
}

export default function SubscriptionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [sub, setSub] = useState<SubscriptionDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"schedules" | "invoices" | "history">("schedules");

  // Modify Modal State
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [newQuantity, setNewQuantity] = useState<number>(1);
  const [submittingChange, setSubmittingChange] = useState(false);
  const [changeResult, setChangeResult] = useState<any>(null);
  const { format } = useCurrency();

  // Cancel Modal State
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [submittingCancel, setSubmittingCancel] = useState(false);

  const fetchSubscription = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<ApiResponse<SubscriptionDetail>>(`/api/v1/subscriptions/${id}`);
      setSub(res.data);
      setSelectedPlanId(res.data.subscription_plan_id ? String(res.data.subscription_plan_id) : "");
      setNewQuantity(res.data.quantity);
    } catch (err: any) {
      setError(err.message || "Failed to load subscription details");
    } finally {
      setLoading(false);
    }
  };

  const fetchPlans = async () => {
    try {
      const res = await api.get<ApiResponse<Plan[]>>("/api/v1/subscriptions/plans");
      setPlans(res.data);
    } catch (err) {
      console.error("Failed to load plans", err);
    }
  };

  useEffect(() => {
    if (id) {
      fetchSubscription();
      fetchPlans();
    }
  }, [id]);

  const handleModifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sub) return;
    setSubmittingChange(true);
    setChangeResult(null);
    try {
      const body: any = {};
      if (selectedPlanId && Number(selectedPlanId) !== sub.subscription_plan_id) {
        body.new_plan_id = Number(selectedPlanId);
      }
      if (newQuantity !== sub.quantity) {
        body.new_quantity = newQuantity;
      }

      const res = await api.post<ApiResponse<any>>(`/api/v1/subscriptions/${sub.id}/change`, body);
      setChangeResult(res.data);
      setShowModifyModal(false);
      fetchSubscription();
    } catch (err: any) {
      setError(err.message || "Failed to modify subscription");
    } finally {
      setSubmittingChange(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sub) return;
    setSubmittingCancel(true);
    try {
      await api.post(`/api/v1/subscriptions/${sub.id}/cancel`, { reason: cancelReason });
      setShowCancelModal(false);
      fetchSubscription();
    } catch (err: any) {
      setError(err.message || "Failed to cancel subscription");
    } finally {
      setSubmittingCancel(false);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (loading) {
    return <div className="p-12 text-center text-gray-400">Loading subscription details...</div>;
  }

  if (error || !sub) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm">
          {error || "Subscription not found"}
        </div>
        <Link href="/internal/subscriptions" className="text-sm font-semibold text-indigo-600 hover:underline">
          ← Back to Subscriptions List
        </Link>
      </div>
    );
  }

  // Calculate proration preview math on frontend
  const selectedPlan = plans.find((p) => String(p.id) === selectedPlanId);
  const targetUnitPrice = selectedPlan ? selectedPlan.price : sub.unit_price;

  const now = new Date();
  const start = new Date(sub.current_period_start);
  const end = new Date(sub.current_period_end);
  const periodDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const remainingDays = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  const remainingFraction = remainingDays / periodDays;

  const oldPeriodValue = sub.unit_price * sub.quantity;
  const newPeriodValue = targetUnitPrice * newQuantity;
  const estimatedProration = Number(((newPeriodValue - oldPeriodValue) * remainingFraction).toFixed(2));

  // Calculate unused prepaid balance for cancellation preview
  const estimatedUnusedPrepaid = Number((oldPeriodValue * remainingFraction).toFixed(2));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/internal/subscriptions"
          className="text-xs font-semibold text-gray-500 hover:text-gray-900 flex items-center gap-1"
        >
          ← Back to Subscriptions
        </Link>
        <button
          onClick={() => exportSubscriptionPdf(sub)}
          className="px-3 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-2xs"
        >
          ⬇ Export PDF
        </button>

      </div>

      {/* Main Header Card */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 pb-5">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{sub.plan_name}</h1>
              <span
                className={`px-3 py-1 text-xs font-bold rounded-full border ${sub.status === "ACTIVE"
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                    : sub.status === "PAUSED"
                      ? "bg-amber-100 text-amber-800 border-amber-300"
                      : "bg-gray-100 text-gray-600 border-gray-300"
                  }`}
              >
                ● {sub.status}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Customer: <span className="font-semibold text-gray-800">{sub.customer_name}</span> ({sub.customer_email})
              {sub.quotation_number && (
                <>
                  {" "}
                  • Quote:{" "}
                  <Link
                    href={`/internal/quotations/${sub.quotation_id}`}
                    className="text-indigo-600 font-mono hover:underline"
                  >
                    {sub.quotation_number}
                  </Link>
                </>
              )}
            </p>
          </div>

          {/* Action Buttons */}
          {sub.status === "ACTIVE" && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowModifyModal(true)}
                className="px-4 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors shadow-2xs"
              >
                ✏️ Modify Plan / Quantity
              </button>
              <button
                onClick={() => setShowCancelModal(true)}
                className="px-4 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors shadow-2xs"
              >
                🚫 Cancel Subscription
              </button>
            </div>
          )}
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <span className="text-2xs font-bold text-gray-400 uppercase tracking-wider">Recurring Amount</span>
            <div className="text-lg font-extrabold text-gray-900 mt-1">
              {format(sub.recurring_amount)}
            </div>
            <div className="text-2xs text-gray-500 font-mono mt-0.5">
              {sub.quantity} × {format(sub.unit_price)}
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <span className="text-2xs font-bold text-gray-400 uppercase tracking-wider">Billing Cycle</span>
            <div className="text-lg font-bold text-slate-800 mt-1">{sub.billing_cycle}</div>
            <div className="text-2xs text-emerald-700 font-semibold mt-0.5">Daily Pro-Rata</div>
          </div>

          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <span className="text-2xs font-bold text-gray-400 uppercase tracking-wider">Current Period</span>
            <div className="text-xs font-semibold text-gray-800 mt-2 font-mono">
              {formatDate(sub.current_period_start)}
            </div>
            <div className="text-2xs text-gray-500 font-mono">to {formatDate(sub.current_period_end)}</div>
          </div>

          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <span className="text-2xs font-bold text-gray-400 uppercase tracking-wider">Next Billing Date</span>
            <div className="text-xs font-bold text-indigo-600 mt-2 font-mono">
              {formatDate(sub.next_billing_date)}
            </div>
            <div className="text-2xs text-gray-400">{remainingDays} days remaining</div>
          </div>

          <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200">
            <span className="text-2xs font-bold text-emerald-600 uppercase tracking-wider">Credit Wallet</span>
            <div className="text-lg font-extrabold text-emerald-900 mt-1">
              {format(sub.wallet_balance)}
            </div>
            <div className="text-2xs text-emerald-700 font-semibold mt-0.5">Auto-offsets invoices</div>
          </div>

          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <span className="text-2xs font-bold text-gray-400 uppercase tracking-wider">Product SKU</span>
            <div className="text-xs font-mono font-bold text-gray-800 mt-2">{sub.sku}</div>
            <div className="text-2xs text-gray-500 truncate">{sub.product_name}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 space-x-4">
        <button
          onClick={() => setActiveTab("schedules")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === "schedules"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
        >
          📅 Billing Schedule ({sub.schedules.length})
        </button>
        <button
          onClick={() => setActiveTab("invoices")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === "invoices"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
        >
          📄 Invoices ({sub.invoices.length})
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === "history"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
        >
          📜 History & Proration Audit ({sub.history.length})
        </button>
      </div>

      {/* Tab Contents */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-2xs p-6">
        {/* Tab 1: Billing Schedule Timeline */}
        {activeTab === "schedules" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">Billing Schedule Timeline</h3>
              <span className="text-xs text-gray-500">
                Driven automatically by billing engine schedule generator
              </span>
            </div>

            {sub.schedules.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No billing schedules generated yet.</p>
            ) : (
              <div className="relative border-l border-indigo-200 ml-4 space-y-6 py-2">
                {sub.schedules.map((sched) => (
                  <div key={sched.id} className="relative pl-6">
                    {/* Timeline point */}
                    <div
                      className={`absolute -left-2 top-1 w-4 h-4 rounded-full border-2 bg-white ${sched.status === "PAID"
                          ? "border-emerald-500 bg-emerald-500"
                          : sched.status === "GENERATED"
                            ? "border-blue-500"
                            : sched.status === "UPCOMING"
                              ? "border-amber-500"
                              : "border-gray-300"
                        }`}
                    />
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-gray-900">
                            {format(sched.amount)}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-2xs font-bold rounded-full ${sched.status === "PAID"
                                ? "bg-emerald-100 text-emerald-800"
                                : sched.status === "GENERATED"
                                  ? "bg-blue-100 text-blue-800"
                                  : sched.status === "UPCOMING"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-gray-100 text-gray-600"
                              }`}
                          >
                            {sched.status}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1 font-mono">
                          Period: {formatDate(sched.period_start)} – {formatDate(sched.period_end)}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs text-gray-400 font-mono">
                          Billing Date: <span className="font-semibold text-gray-700">{formatDate(sched.billing_date)}</span>
                        </div>
                        {sched.invoice_number && (
                          <div className="text-xs font-semibold text-indigo-600 mt-1">
                            Invoice: #{sched.invoice_number}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Invoices */}
        {activeTab === "invoices" && (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-gray-900">Subscription Invoices & Payments</h3>
            {sub.invoices.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No invoices generated yet for this subscription.</p>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-3">Invoice Number</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Total Amount</th>
                      <th className="px-4 py-3">Wallet Offset</th>
                      <th className="px-4 py-3">Total Paid</th>
                      <th className="px-4 py-3">Balance Due</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sub.invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-gray-50/80">
                        <td className="px-4 py-3 font-mono font-bold text-indigo-600">{inv.invoice_number}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-semibold">
                            {inv.invoice_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold">{format(inv.grand_total)}</td>
                        <td className="px-4 py-3 text-emerald-700 font-semibold">
                          {format(inv.wallet_offset_amount)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-800">
                          {format(inv.total_paid)}
                        </td>
                        <td className="px-4 py-3 font-bold text-gray-900">
                          {format(inv.balance_due)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2.5 py-0.5 text-2xs font-bold rounded-full ${inv.status === "PAID"
                                ? "bg-emerald-100 text-emerald-800"
                                : inv.status === "PARTIALLY_PAID"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: History & Proration Audit */}
        {activeTab === "history" && (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-gray-900">Subscription History & Proration Ledger</h3>
            {sub.history.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No modifications or plan changes recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {sub.history.map((change) => (
                  <div key={change.id} className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-md">
                        {change.change_type}
                      </span>
                      <span className="text-2xs font-mono text-gray-400">{formatDate(change.created_at)}</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
                      <div>
                        <span className="text-gray-400">Old Value:</span>{" "}
                        <span className="font-semibold text-gray-800">
                          {format(change.old_period_value)} (qty: {change.old_quantity})
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400">New Value:</span>{" "}
                        <span className="font-semibold text-gray-800">
                          {format(change.new_period_value)} (qty: {change.new_quantity})
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400">Prorated Days:</span>{" "}
                        <span className="font-semibold text-gray-800">
                          {change.remaining_days} / {change.period_days} days
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400">Proration Amount:</span>{" "}
                        <span
                          className={`font-bold ${change.proration_amount > 0
                              ? "text-rose-600"
                              : change.proration_amount < 0
                                ? "text-emerald-600"
                                : "text-gray-700"
                            }`}
                        >
                          {change.proration_amount > 0 ? "+" : ""}
                          {format(change.proration_amount)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL 1: Modify Plan / Quantity */}
      {showModifyModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-gray-200 max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-lg font-bold text-gray-900">Modify Plan / Quantity</h3>
              <button onClick={() => setShowModifyModal(false)} className="text-gray-400 hover:text-gray-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleModifySubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Target Subscription Plan</label>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">(Keep Current Unit Price: ${sub.unit_price})</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — ${p.price}/{p.billing_cycle.toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Quantity / Seats</label>
                <input
                  type="number"
                  min="1"
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(parseInt(e.target.value) || 1)}
                  className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Server Proration Formula Preview Box */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                <div className="font-bold text-slate-900 border-b border-slate-200 pb-1">
                  ⚡ Daily Rate Proration Preview
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Current Period Value:</span>
                  <span className="font-semibold">{format(oldPeriodValue)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>New Period Value:</span>
                  <span className="font-semibold">{format(newPeriodValue)}</span>
                </div>
                <div className="flex justify-between text-slate-600 font-mono">
                  <span>Remaining Fraction:</span>
                  <span>
                    {remainingDays} / {periodDays} days ({Math.round(remainingFraction * 100)}%)
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-sm">
                  <span>Prorated Adjustment:</span>
                  <span className={estimatedProration >= 0 ? "text-indigo-600" : "text-emerald-600"}>
                    {estimatedProration >= 0 ? `+${format(estimatedProration)} (Owed)` : `${format(estimatedProration)} (Credit)`}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModifyModal(false)}
                  className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingChange}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submittingChange ? "Applying Change..." : "Confirm Subscription Modification"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Cancel Subscription */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-gray-200 max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-lg font-bold text-rose-900">Cancel Subscription</h3>
              <button onClick={() => setShowCancelModal(false)} className="text-gray-400 hover:text-gray-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCancelSubmit} className="space-y-4">
              <p className="text-xs text-gray-600 leading-relaxed">
                Cancelling this subscription will immediately halt future billing schedules. Unused prepaid balance will be credited to the customer&apos;s Credit Wallet for future use.
              </p>

              {/* Cancellation Credit Calculation Box */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2 text-xs">
                <div className="font-bold text-emerald-900 border-b border-emerald-200 pb-1">
                  💰 Calculated Unused Prepaid Credit
                </div>
                <div className="flex justify-between text-emerald-800 font-mono">
                  <span>Unused Period Days:</span>
                  <span>
                    {remainingDays} of {periodDays} days
                  </span>
                </div>
                <div className="flex justify-between border-t border-emerald-200 pt-2 font-bold text-sm text-emerald-950">
                  <span>Wallet Credit Refund:</span>
                  <span>+{format(estimatedUnusedPrepaid)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Reason for Cancellation</label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Customer requested early termination"
                  className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-rose-500"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Keep Subscription Active
                </button>
                <button
                  type="submit"
                  disabled={submittingCancel}
                  className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                >
                  {submittingCancel ? "Cancelling..." : "Confirm Cancellation & Credit Wallet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
