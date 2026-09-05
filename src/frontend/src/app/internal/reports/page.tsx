"use client";

import { useEffect, useState, useCallback } from "react";
import { api, ApiResponse } from "@/lib/api";
import { exportReportPdf, fmtMoney } from "@/lib/pdf";

interface Overview {
  base_currency: string;
  pipeline: {
    total_quotations: number;
    confirmed_count: number;
    open_count: number;
    open_value: number;
    confirmed_value: number;
    win_rate: number;
  };
  revenue: { invoiced: number; collected: number; outstanding: number; overdue_count: number };
  fulfillment: { orders_total: number; partial_count: number; units_backordered: number };
  subscriptions: { active_count: number; monthly_recurring_value: number };
  deal_health: { healthy: number; at_risk: number; critical: number };
}

interface RevenueMonth {
  period: string;
  invoiced: number;
  collected: number;
  outstanding: number;
}

interface SalesRep {
  sales_rep_id: number;
  sales_rep_name: string;
  quotation_count: number;
  confirmed_count: number;
  confirmed_value: number;
  pipeline_value: number;
}

interface TopCustomer {
  customer_id: number;
  customer_name: string;
  company: string | null;
  invoice_count: number;
  invoiced: number;
  collected: number;
  overdue_count: number;
}

interface PipelineStatus {
  status: string;
  count: number;
  value: number;
  avg_ticket: number;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function monthStartOffset(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const [from, setFrom] = useState(() => monthStartOffset(11));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [months, setMonths] = useState<RevenueMonth[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
  const [statuses, setStatuses] = useState<PipelineStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReports = useCallback(async (fromDate: string, toDate: string) => {
    setLoading(true);
    setError("");
    try {
      const params = { from: fromDate, to: toDate };
      const [ov, rev, sales, pipe] = await Promise.all([
        api.get<ApiResponse<Overview>>("/api/v1/reports/overview"),
        api.get<ApiResponse<{ months: RevenueMonth[] }>>("/api/v1/reports/revenue", params),
        api.get<ApiResponse<{ sales_reps: SalesRep[]; top_customers: TopCustomer[] }>>("/api/v1/reports/sales", params),
        api.get<ApiResponse<{ statuses: PipelineStatus[] }>>("/api/v1/reports/pipeline", params),
      ]);
      setOverview(ov.data);
      setMonths(rev.data.months || []);
      setSalesReps(sales.data.sales_reps || []);
      setTopCustomers(sales.data.top_customers || []);
      setStatuses(pipe.data.statuses || []);
    } catch (err: any) {
      setError(err.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports(from, to);
  }, [loadReports, from, to]);

  const handleExport = () => {
    exportReportPdf({
      base_currency: overview?.base_currency || "USD",
      from,
      to,
      overview: overview
        ? {
            pipeline: overview.pipeline,
            revenue: overview.revenue,
            subscriptions: overview.subscriptions,
            fulfillment: overview.fulfillment,
            deal_health: overview.deal_health,
          }
        : undefined,
      months,
      sales_reps: salesReps,
      top_customers: topCustomers,
      statuses,
    });
  };

  const cur = overview?.base_currency || "USD";
  const kpiCards = [
    { label: "Invoiced Revenue", value: fmtMoney(overview?.revenue.invoiced), color: "text-blue-600", sub: `${overview?.revenue.overdue_count ?? 0} overdue` },
    { label: "Collected", value: fmtMoney(overview?.revenue.collected), color: "text-green-600", sub: "Payments received" },
    { label: "Outstanding", value: fmtMoney(overview?.revenue.outstanding), color: "text-red-600", sub: "Unpaid balance" },
    { label: "Open Pipeline", value: fmtMoney(overview?.pipeline.open_value), color: "text-indigo-600", sub: `${overview?.pipeline.open_count ?? 0} open quotes` },
    { label: "Confirmed Value", value: fmtMoney(overview?.pipeline.confirmed_value), color: "text-emerald-600", sub: `${overview?.pipeline.confirmed_count ?? 0} confirmed` },
    { label: "Win Rate", value: `${Number(overview?.pipeline.win_rate ?? 0).toFixed(1)}%`, color: "text-purple-600", sub: "Confirmed / total" },
    { label: "MRR (Active Subs)", value: fmtMoney(overview?.subscriptions.monthly_recurring_value), color: "text-cyan-600", sub: `${overview?.subscriptions.active_count ?? 0} active` },
    { label: "Backordered Units", value: String(overview?.fulfillment.units_backordered ?? 0), color: "text-amber-600", sub: `${overview?.fulfillment.orders_total ?? 0} orders` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500">Revenue, pipeline, and sales performance across RevSync.</p>
        </div>
        <button
          onClick={handleExport}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
        >
          ⬇ Export Report PDF
        </button>
      </div>

      {/* Period Filter */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-end flex-wrap gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setFrom(monthStartOffset(2));
              setTo(new Date().toISOString().slice(0, 10));
            }}
            className="bg-gray-100 hover:bg-gray-200 text-xs font-semibold px-3 py-2 rounded-md"
          >
            3 Months
          </button>
          <button
            onClick={() => {
              setFrom(monthStartOffset(11));
              setTo(new Date().toISOString().slice(0, 10));
            }}
            className="bg-gray-100 hover:bg-gray-200 text-xs font-semibold px-3 py-2 rounded-md"
          >
            12 Months
          </button>
          <button
            onClick={() => {
              setFrom(`${new Date().getFullYear()}-01-01`);
              setTo(new Date().toISOString().slice(0, 10));
            }}
            className="bg-gray-100 hover:bg-gray-200 text-xs font-semibold px-3 py-2 rounded-md"
          >
            YTD
          </button>
        </div>
        <span className="text-xs text-gray-400 font-mono ml-auto">
          {loading ? "Loading..." : `${from} → ${to}`}
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{kpi.label}</h3>
            <p className={`text-2xl font-bold mt-2 ${kpi.color}`}>{loading && !overview ? "..." : `${cur} ${kpi.value}`}</p>
            <span className="text-xs text-gray-400 mt-1 block">{kpi.sub}</span>
          </div>
        ))}
      </div>

      {/* Monthly Revenue */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Monthly Revenue</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Month</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Invoiced</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Collected</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-400">Loading revenue...</td>
                </tr>
              ) : months.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-400">No revenue recorded for this period.</td>
                </tr>
              ) : (
                months.map((m) => (
                  <tr key={m.period} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono font-bold text-gray-900">{m.period}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{cur} {fmtMoney(m.invoiced)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-green-700">{cur} {fmtMoney(m.collected)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-red-700">{cur} {fmtMoney(m.outstanding)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Rep Rankings */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-900">Sales Rep Rankings</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Sales Rep</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500 uppercase">Quotes</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500 uppercase">Won</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Confirmed Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-400">Loading sales reps...</td>
                  </tr>
                ) : salesReps.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-400">No sales data for this period.</td>
                  </tr>
                ) : (
                  salesReps.map((r) => (
                    <tr key={r.sales_rep_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-semibold text-gray-900">{r.sales_rep_name}</td>
                      <td className="px-4 py-2.5 text-center text-gray-600">{r.quotation_count}</td>
                      <td className="px-4 py-2.5 text-center text-gray-600">{r.confirmed_count}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-blue-700">{cur} {fmtMoney(r.confirmed_value)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quotation Funnel */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-900">Quotation Funnel</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500 uppercase">Count</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Value</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Avg Ticket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-400">Loading funnel...</td>
                  </tr>
                ) : statuses.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-400">No quotations for this period.</td>
                  </tr>
                ) : (
                  statuses.map((s) => (
                    <tr key={s.status} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <span className="font-mono font-bold text-gray-800">{s.status}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-600">{s.count}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{cur} {fmtMoney(s.value)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{cur} {fmtMoney(s.avg_ticket)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Top Customers */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Top Customers</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Customer</th>
                <th className="px-4 py-3 text-center font-medium text-gray-500 uppercase">Invoices</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Invoiced</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Collected</th>
                <th className="px-4 py-3 text-center font-medium text-gray-500 uppercase">Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400">Loading customers...</td>
                </tr>
              ) : topCustomers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400">No customer data for this period.</td>
                </tr>
              ) : (
                topCustomers.map((c) => (
                  <tr key={c.customer_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-gray-900">{c.customer_name}</span>
                      {c.company && <span className="text-gray-400 ml-1">({c.company})</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center text-gray-600">{c.invoice_count}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{cur} {fmtMoney(c.invoiced)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-green-700">{cur} {fmtMoney(c.collected)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {c.overdue_count > 0 ? (
                        <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold">{c.overdue_count}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
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