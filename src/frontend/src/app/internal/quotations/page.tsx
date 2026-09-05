"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiResponse } from "@/lib/api";
import { useCurrency } from "@/components/CurrencyProvider";

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
  company?: string;
  tier_name?: string;
  currency_code?: string;
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
  const { format } = useCurrency();

  // View Mode: 'kanban' or 'list'
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");

  // Status Filter for List View
  const [selectedStatus, setSelectedStatus] = useState<string>("");

  // Customer Filter State (0 = All Customers)
  const [filterCustomerId, setFilterCustomerId] = useState<number>(0);
  const [customerSearchTerm, setCustomerSearchTerm] = useState<string>("");
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState<boolean>(false);
  const [isSearchingCustomers, setIsSearchingCustomers] = useState<boolean>(false);
  const customerSearchTimer = useRef<NodeJS.Timeout | null>(null);

  // Drag and Drop state
  const [draggedQuoteId, setDraggedQuoteId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const handleCustomerSearchInputChange = (term: string) => {
    setCustomerSearchTerm(term);

    if (customerSearchTimer.current) {
      clearTimeout(customerSearchTimer.current);
    }

    if (!term.trim()) {
      setCustomers([]);
      setIsCustomerDropdownOpen(false);
      return;
    }

    setIsCustomerDropdownOpen(true);
    setIsSearchingCustomers(true);

    customerSearchTimer.current = setTimeout(async () => {
      try {
        const res = await api.get<ApiResponse<Customer[]>>("/api/v1/customers", {
          search: term.trim(),
          limit: "20",
        });
        setCustomers(res.data);
      } catch {
        setCustomers([]);
      } finally {
        setIsSearchingCustomers(false);
      }
    }, 300);
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
      if (filterCustomerId > 0) {
        params.customer_id = filterCustomerId.toString();
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
    fetchQuotations();
  }, [page, selectedStatus, filterCustomerId, viewMode]);

  // Toast Notification State
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Mutating quote id during drag drop
  const [mutatingQuoteId, setMutatingQuoteId] = useState<number | null>(null);

  const handleOpenBuilderDirectly = async () => {
    const activeCustomerId = filterCustomerId > 0 ? filterCustomerId : 1;
    try {
      const res = await api.post<ApiResponse<Quotation>>("/api/v1/quotations", {
        customer_id: Number(activeCustomerId),
        tax_rate_pct: 10.0,
      });
      // Redirect directly to full Quotation Builder screen
      router.push(`/internal/quotations/${res.data.id}`);
    } catch (err: any) {
      showToast(err.message || "Failed to start new quotation", "error");
    }
  };

  const isValidTransition = (fromStatus: string, toStatus: string): boolean => {
    if (fromStatus === toStatus) return false;
    if (fromStatus === "DRAFT" && toStatus === "PENDING_APPROVAL") return true;
    if (fromStatus === "PENDING_APPROVAL" && toStatus === "DRAFT") return true;
    return false;
  };

  // Move Quote Status via Drag & Drop
  const handleDrop = async (targetStatus: string) => {
    if (!draggedQuoteId) return;

    const currentQuote = quotations.find((q) => q.id === draggedQuoteId);
    setDragOverCol(null);

    if (!currentQuote || currentQuote.status === targetStatus) {
      setDraggedQuoteId(null);
      return;
    }

    if (!isValidTransition(currentQuote.status, targetStatus)) {
      showToast(
        `Cannot move quote directly from ${currentQuote.status} to ${targetStatus}. Please use action buttons on Detail screen.`,
        "error"
      );
      setDraggedQuoteId(null);
      return;
    }

    setMutatingQuoteId(draggedQuoteId);

    try {
      if (currentQuote.status === "DRAFT" && targetStatus === "PENDING_APPROVAL") {
        const res = await api.post<ApiResponse<Quotation>>(`/api/v1/quotations/${draggedQuoteId}/submit`);
        showToast(
          `Quotation ${res.data.quotation_number || currentQuote.quotation_number} submitted for approval (Status: ${res.data.status})`,
          "success"
        );
      } else if (currentQuote.status === "PENDING_APPROVAL" && targetStatus === "DRAFT") {
        const res = await api.post<ApiResponse<Quotation>>(`/api/v1/quotations/${draggedQuoteId}/withdraw`);
        showToast(
          `Quotation ${res.data.quotation_number || currentQuote.quotation_number} withdrawn to Draft`,
          "success"
        );
      }
      await fetchQuotations();
    } catch (err: any) {
      showToast(err.message || "Failed to update quotation status", "error");
      await fetchQuotations();
    } finally {
      setMutatingQuoteId(null);
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

        <div className="flex flex-wrap items-center gap-3">
          {/* Customer Search Filter Combobox */}
          <div className="relative flex items-center gap-1.5 bg-gray-100 p-1 rounded-lg border border-gray-200">
            <span className="text-xs font-bold text-gray-500 pl-2">Customer:</span>
            <div className="relative">
              <input
                type="text"
                placeholder="Search customer / company..."
                value={customerSearchTerm}
                onFocus={() => {
                  if (customerSearchTerm.trim().length > 0) setIsCustomerDropdownOpen(true);
                }}
                onChange={(e) => handleCustomerSearchInputChange(e.target.value)}
                className="bg-white text-xs font-semibold text-gray-800 border border-gray-300 rounded px-2.5 py-1 focus:ring-2 focus:ring-blue-500 focus:outline-none w-56 truncate"
              />

              {/* Floating Recommendations Dropdown (only when typing) */}
              {isCustomerDropdownOpen && customerSearchTerm.trim().length > 0 && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setIsCustomerDropdownOpen(false)}
                  />
                  <div className="absolute left-0 top-full mt-1 z-30 w-72 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto divide-y divide-gray-100 text-xs">
                    {isSearchingCustomers ? (
                      <div className="px-3 py-3 text-gray-400 italic text-center flex items-center justify-center gap-1.5">
                        <span className="animate-spin inline-block">⏳</span>
                        <span>Searching database...</span>
                      </div>
                    ) : customers.length === 0 ? (
                      <div className="px-3 py-3 text-gray-400 italic text-center">
                        No matching customers found
                      </div>
                    ) : (
                      customers.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setFilterCustomerId(c.id);
                            setCustomerSearchTerm(c.name);
                            setIsCustomerDropdownOpen(false);
                            setPage(1);
                          }}
                          className={`px-3 py-2 hover:bg-blue-50 cursor-pointer transition flex flex-col gap-0.5 ${filterCustomerId === c.id ? "bg-blue-50 text-blue-700 font-bold" : "text-gray-800"
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-gray-900">{c.name}</span>
                            {c.currency_code && (
                              <span className="text-[10px] font-mono text-gray-400 uppercase">{c.currency_code}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-500 flex items-center gap-1.5">
                            {c.company && <span>{c.company}</span>}
                            {c.tier_name && (
                              <span className="bg-purple-50 text-purple-700 px-1 rounded font-semibold">
                                {c.tier_name}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {(filterCustomerId > 0 || customerSearchTerm) && (
              <button
                onClick={() => {
                  setFilterCustomerId(0);
                  setCustomerSearchTerm("");
                  setIsCustomerDropdownOpen(false);
                  setPage(1);
                }}
                className="text-xs text-red-600 hover:text-red-800 font-bold px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 transition"
                title="Clear Customer Search"
              >
                ✕ Clear
              </button>
            )}
          </div>

          {/* View Toggle Switch */}
          <div className="inline-flex p-0.5 bg-gray-100 rounded-lg border border-gray-200 text-xs font-semibold">
            <button
              onClick={() => setViewMode("kanban")}
              className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${viewMode === "kanban"
                ? "bg-white text-blue-700 shadow-xs font-bold"
                : "text-gray-600 hover:text-gray-900"
                }`}
            >
              📊 Kanban Board
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${viewMode === "list"
                ? "bg-white text-blue-700 shadow-xs font-bold"
                : "text-gray-600 hover:text-gray-900"
                }`}
            >
              📋 List View
            </button>
          </div>

          <button
            onClick={handleOpenBuilderDirectly}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-semibold transition shadow-xs"
          >
            + New Quotation
          </button>
        </div>
      </div>

      {/* Floating Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl text-xs font-bold flex items-center gap-2 border transition-all ${
            toast.type === "success"
              ? "bg-emerald-900 text-emerald-100 border-emerald-700"
              : toast.type === "error"
              ? "bg-rose-900 text-rose-100 border-rose-700"
              : "bg-slate-900 text-slate-100 border-slate-700"
          }`}
        >
          <span>{toast.type === "success" ? "✓" : toast.type === "error" ? "⚠️" : "ℹ️"}</span>
          <span>{toast.message}</span>
        </div>
      )}

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
              const activeDraggedQuote = quotations.find((q) => q.id === draggedQuoteId);
              const isValidDrop = activeDraggedQuote
                ? isValidTransition(activeDraggedQuote.status, col.id)
                : false;

              let colBorderBg = "border-gray-200";
              if (isOver) {
                if (isValidDrop) {
                  colBorderBg = "border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-400/60";
                } else {
                  colBorderBg = "border-rose-400 bg-rose-50/50 ring-2 ring-rose-300/50 cursor-not-allowed";
                }
              }

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
                  className={`bg-gray-50/90 rounded-xl border border-t-4 ${col.borderTop} p-3 flex flex-col min-h-[550px] transition-all ${colBorderBg}`}
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
                      {format(colTotalSum)}
                    </span>
                  </div>

                  {/* Cards Container */}
                  <div className="space-y-2.5 flex-1 overflow-y-auto">
                    {loading ? (
                      <div className="text-center py-8 text-xs text-gray-400">Loading...</div>
                    ) : colQuotes.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg text-xs text-gray-400">
                        {isOver ? (isValidDrop ? "Drop here to update status" : "Invalid status move") : "No quotes"}
                      </div>
                    ) : (
                      colQuotes.map((q) => {
                        const isMutatingThis = mutatingQuoteId === q.id;
                        return (
                          <div
                            key={q.id}
                            draggable={!isMutatingThis}
                            onDragStart={(e) => {
                              setDraggedQuoteId(q.id);
                              e.dataTransfer.setData("text/plain", q.id.toString());
                            }}
                            onClick={() => router.push(`/internal/quotations/${q.id}`)}
                            className={`bg-white rounded-lg border border-gray-200 p-3 shadow-xs hover:shadow-md hover:border-blue-400 transition cursor-grab active:cursor-grabbing select-none group relative ${
                              isMutatingThis ? "opacity-60 pointer-events-none" : ""
                            }`}
                          >
                            {isMutatingThis && (
                              <div className="absolute inset-0 bg-white/70 rounded-lg flex items-center justify-center gap-1.5 text-xs font-bold text-blue-700 z-10">
                                <span className="animate-spin inline-block">⏳</span> Updating status...
                              </div>
                            )}

                            {/* Top Row: Quote ID */}
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-mono text-xs font-extrabold text-blue-600 group-hover:underline flex items-center gap-1">
                                {q.quotation_number}
                                {q.status === "REJECTED" && (
                                  <span className="text-[9px] font-mono bg-rose-100 text-rose-800 px-1 py-0.2 rounded">
                                    REJECTED
                                  </span>
                                )}
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
                              {format(q.grand_total)}
                            </span>
                          </div>
                          </div>
                        );
                      })
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
                className={`py-2 px-4 border-b-2 font-medium whitespace-nowrap transition ${selectedStatus === tab.value
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
                          className={`px-2 py-0.5 text-xs font-bold rounded ${q.status === "APPROVED"
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
                        {format(q.grand_total)}
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
    </div>
  );
}
