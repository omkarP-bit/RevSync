"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiResponse } from "@/lib/api";

interface Quotation {
  id: number;
  quotation_number: string;
  customer_name: string;
  sales_rep_name: string;
  currency_code: string;
  status: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  margin_pct: number;
  created_at: string;
}

interface Customer {
  id: number;
  name: string;
  currency_code: string;
}

const KANBAN_COLUMNS = [
  { id: "DRAFT", title: "Draft", badgeBg: "bg-gray-200 text-gray-800", borderTop: "border-t-gray-400" },
  { id: "PENDING_APPROVAL", title: "Pending Approval", badgeBg: "bg-amber-100 text-amber-800", borderTop: "border-t-amber-500" },
  { id: "APPROVED", title: "Approved", badgeBg: "bg-green-100 text-green-800", borderTop: "border-t-green-500" },
  { id: "NEGOTIATION", title: "Negotiation", badgeBg: "bg-purple-100 text-purple-800", borderTop: "border-t-purple-500" },
  { id: "CONFIRMED", title: "Confirmed", badgeBg: "bg-blue-100 text-blue-800", borderTop: "border-t-blue-500" },
  { id: "CANCELLED", title: "Cancelled", badgeBg: "bg-red-100 text-red-800", borderTop: "border-t-red-500" },
];

export default function QuotationsListPage() {
  const router = useRouter();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // View Mode: 'kanban' or 'list'
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");

  // Status Filter for List View
  const [selectedStatus, setSelectedStatus] = useState<string>("");

  // Create Modal
  const [showModal, setShowModal] = useState(false);
  const [customerId, setCustomerId] = useState<number>(0);
  const [taxRatePct, setTaxRatePct] = useState<number>(10.0);
  const [notes, setNotes] = useState("");

  // Drag and Drop state
  const [draggedQuoteId, setDraggedQuoteId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const fetchCustomers = async () => {
    try {
      const res = await api.get<ApiResponse<Customer[]>>("/api/v1/customers", { limit: "100" });
      setCustomers(res.data);
      if (res.data.length > 0) setCustomerId(res.data[0].id);
    } catch {
      // ignore
    }
  };

  const fetchQuotations = async () => {
    setLoading(true);
    try {
      const limit = viewMode === "kanban" ? "100" : "10";
      const params: Record<string, string> = {
        page: viewMode === "kanban" ? "1" : page.toString(),
        limit,
      };
      if (viewMode === "list" && selectedStatus) {
        params.status = selectedStatus;
      }

      const res = await api.get<ApiResponse<Quotation[]>>("/api/v1/quotations", params);
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
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    fetchQuotations();
  }, [page, selectedStatus, viewMode]);

  const handleCreateQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeCustomerId = customerId || (customers.length > 0 ? Number(customers[0].id) : 0);
    if (!activeCustomerId) {
      alert("Please select a customer first.");
      return;
    }

    try {
      const res = await api.post<ApiResponse<Quotation>>("/api/v1/quotations", {
        customer_id: Number(activeCustomerId),
        tax_rate_pct: Number(taxRatePct) || 10.0,
        notes: notes || undefined,
      });

      setShowModal(false);
      setNotes("");
      // Redirect directly to full Quotation Builder screen
      router.push(`/internal/quotations/${res.data.id}`);
    } catch (err: any) {
      alert(err.message || "Failed to create quotation");
    }
  };

  // Move Quote Status via Drag & Drop
  const handleDrop = async (targetStatus: string) => {
    if (!draggedQuoteId) return;

    const currentQuote = quotations.find((q) => q.id === draggedQuoteId);
    if (currentQuote && currentQuote.status === targetStatus) {
      setDragOverCol(null);
      setDraggedQuoteId(null);
      return;
    }

    setQuotations((prev) =>
      prev.map((q) => (q.id === draggedQuoteId ? { ...q, status: targetStatus } : q))
    );

    setDragOverCol(null);

    try {
      await api.patch(`/api/v1/quotations/${draggedQuoteId}`, { status: targetStatus });
      fetchQuotations();
    } catch (err: any) {
      alert(err.message || "Failed to update quotation status");
      fetchQuotations();
    } finally {
      setDraggedQuoteId(null);
    }
  };

  const listStatuses = [
    { label: "All Statuses", value: "" },
    { label: "Draft", value: "DRAFT" },
    { label: "Pending Approval", value: "PENDING_APPROVAL" },
    { label: "Approved", value: "APPROVED" },
    { label: "Negotiation", value: "NEGOTIATION" },
    { label: "Confirmed", value: "CONFIRMED" },
    { label: "Cancelled", value: "CANCELLED" },
  ];

  return (
    <div className="w-full space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quotations Manager</h1>
          <p className="text-xs text-gray-500">Build, configure, and track multi-line sales quotations.</p>
        </div>

        <div className="flex items-center gap-3">
          {/* View Toggle Switch */}
          <div className="inline-flex p-0.5 bg-gray-100 rounded-lg border border-gray-200 text-xs font-semibold">
            <button
              onClick={() => setViewMode("kanban")}
              className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${
                viewMode === "kanban"
                  ? "bg-white text-blue-700 shadow-xs font-bold"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              📊 Kanban Board
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${
                viewMode === "list"
                  ? "bg-white text-blue-700 shadow-xs font-bold"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              📋 List View
            </button>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-semibold transition shadow-xs"
          >
            + New Quotation
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs">{error}</div>}

      {/* VIEW 1: KANBAN BOARD */}
      {viewMode === "kanban" && (
        <div className="w-full overflow-x-auto pb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3.5 w-full min-w-[1000px]">
            {KANBAN_COLUMNS.map((col) => {
              const colQuotes = (Array.isArray(quotations) ? quotations : []).filter((q) =>
                col.id === "CANCELLED"
                  ? q.status === "CANCELLED" || q.status === "REJECTED"
                  : q.status === col.id
              );
              const colTotalSum = colQuotes.reduce((acc, q) => acc + Number(q?.grand_total || 0), 0);
              const isOver = dragOverCol === col.id;

              return (
                <div
                  key={col.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverCol !== col.id) setDragOverCol(col.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverCol === col.id) setDragOverCol(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(col.id);
                  }}
                  className={`bg-gray-50/90 rounded-xl border border-t-4 ${col.borderTop} p-3 flex flex-col min-h-[550px] transition-all ${
                    isOver ? "border-blue-500 bg-blue-50/50 ring-2 ring-blue-400/50" : "border-gray-200"
                  }`}
                >
                  {/* Column Header */}
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-extrabold text-[11px] text-gray-800 uppercase tracking-wider">{col.title}</h3>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${col.badgeBg}`}>
                        {colQuotes.length}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-gray-500">
                      ${colTotalSum.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                  </div>

                  {/* Cards Container */}
                  <div className="space-y-2.5 flex-1 overflow-y-auto">
                    {loading ? (
                      <div className="text-center py-8 text-xs text-gray-400">Loading...</div>
                    ) : colQuotes.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg text-xs text-gray-400">
                        Drop quote here
                      </div>
                    ) : (
                      colQuotes.map((q) => (
                        <div
                          key={q.id}
                          draggable
                          onDragStart={(e) => {
                            setDraggedQuoteId(q.id);
                            e.dataTransfer.setData("text/plain", q.id.toString());
                          }}
                          onClick={() => router.push(`/internal/quotations/${q.id}`)}
                          className="bg-white rounded-lg border border-gray-200 p-3 shadow-xs hover:shadow-md hover:border-blue-400 transition cursor-grab active:cursor-grabbing select-none group"
                        >
                          {/* Top Row: Quote ID */}
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono text-xs font-extrabold text-blue-600 group-hover:underline">
                              {q.quotation_number}
                            </span>
                            <span className="text-[10px] font-mono text-gray-400 uppercase">
                              {q.currency_code}
                            </span>
                          </div>

                          {/* Customer Name */}
                          <div className="text-xs font-bold text-gray-900 truncate mb-2">
                            {q.customer_name}
                          </div>

                          {/* Grand Total */}
                          <div className="pt-1.5 border-t border-gray-100 flex items-center justify-between">
                            <span className="text-[10px] font-medium text-gray-400">Grand Total</span>
                            <span className="text-xs font-extrabold text-gray-900 font-mono">
                              {q.currency_code} {Number(q.grand_total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 2: LIST VIEW */}
      {viewMode === "list" && (
        <div className="space-y-4">
          <div className="flex border-b border-gray-200 gap-2 overflow-x-auto text-sm">
            {listStatuses.map((tab) => (
              <button
                key={tab.value}
                onClick={() => {
                  setSelectedStatus(tab.value);
                  setPage(1);
                }}
                className={`py-2 px-4 border-b-2 font-medium whitespace-nowrap transition ${
                  selectedStatus === tab.value
                    ? "border-blue-600 text-blue-600 font-bold"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-lg shadow-xs overflow-hidden border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
                <tr>
                  <th className="px-6 py-3 text-left">Quote #</th>
                  <th className="px-6 py-3 text-left">Customer</th>
                  <th className="px-6 py-3 text-left">Sales Rep</th>
                  <th className="px-6 py-3 text-left">Currency</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-right">Grand Total</th>
                  <th className="px-6 py-3 text-right">Margin %</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-6 text-center text-gray-500">
                      Loading quotations...
                    </td>
                  </tr>
                ) : quotations.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-6 text-center text-gray-500">
                      No quotations found for this filter.
                    </td>
                  </tr>
                ) : (
                  quotations.map((q) => (
                    <tr key={q.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-mono font-bold text-blue-700">{q.quotation_number}</td>
                      <td className="px-6 py-4 font-semibold text-gray-900">{q.customer_name}</td>
                      <td className="px-6 py-4 text-gray-600">{q.sales_rep_name || "-"}</td>
                      <td className="px-6 py-4 font-bold text-gray-700">{q.currency_code}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-0.5 text-xs font-bold rounded ${
                            q.status === "APPROVED"
                              ? "bg-green-100 text-green-800"
                              : q.status === "PENDING_APPROVAL"
                              ? "bg-amber-100 text-amber-800"
                              : q.status === "CONFIRMED"
                              ? "bg-blue-100 text-blue-800"
                              : q.status === "NEGOTIATION"
                              ? "bg-purple-100 text-purple-800"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {q.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-extrabold text-gray-900">
                        {q.currency_code} {Number(q.grand_total).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-blue-700">
                        {Number(q.margin_pct).toFixed(1)}%
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/internal/quotations/${q.id}`}
                          className="text-blue-600 hover:text-blue-900 font-semibold text-xs inline-flex items-center gap-1"
                        >
                          Edit & Lines &rarr;
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="px-6 py-3 flex items-center justify-between border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
              <div>Showing {quotations.length} of {total} quotations</div>
              <div className="flex gap-2 items-center">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1 border border-gray-300 rounded bg-white font-medium disabled:opacity-50 hover:bg-gray-100"
                >
                  Previous
                </button>
                <span className="py-1">
                  Page {page} of {totalPages}
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1 border border-gray-300 rounded bg-white font-medium disabled:opacity-50 hover:bg-gray-100"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Start New Quotation</h2>
            <form onSubmit={handleCreateQuotation} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Select Customer</label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.currency_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tax Rate (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={taxRatePct}
                  onChange={(e) => setTaxRatePct(parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes / Terms</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none"
                  placeholder="Optional internal deal notes"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 font-medium text-gray-700"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-semibold hover:bg-blue-700">
                  Open Builder &rarr;
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
