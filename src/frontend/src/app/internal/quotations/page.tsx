"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

export default function QuotationsListPage() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Status Tab Filter
  const [selectedStatus, setSelectedStatus] = useState<string>("");

  // Create Modal
  const [showModal, setShowModal] = useState(false);
  const [customerId, setCustomerId] = useState<number>(0);
  const [taxRatePct, setTaxRatePct] = useState<number>(10.0);
  const [notes, setNotes] = useState("");

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
      const params: Record<string, string> = {
        page: page.toString(),
        limit: "10",
      };
      if (selectedStatus) params.status = selectedStatus;

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
  }, [page, selectedStatus]);

  const handleCreateQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<ApiResponse<Quotation>>("/api/v1/quotations", {
        customer_id: customerId,
        tax_rate_pct: taxRatePct,
        notes: notes || undefined,
      });

      setShowModal(false);
      setNotes("");
      fetchQuotations();
    } catch (err: any) {
      alert(err.message || "Failed to create quotation");
    }
  };

  const statuses = [
    { label: "All Statuses", value: "" },
    { label: "Draft", value: "DRAFT" },
    { label: "Pending Approval", value: "PENDING_APPROVAL" },
    { label: "Approved", value: "APPROVED" },
    { label: "Negotiation", value: "NEGOTIATION" },
    { label: "Confirmed", value: "CONFIRMED" },
    { label: "Cancelled", value: "CANCELLED" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quotations Manager</h1>
          <p className="text-sm text-gray-500">Build, configure, and track multi-line sales quotations.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
        >
          + New Quotation
        </button>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex border-b border-gray-200 gap-2 overflow-x-auto text-sm">
        {statuses.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setSelectedStatus(tab.value);
              setPage(1);
            }}
            className={`py-2 px-4 border-b-2 font-medium whitespace-nowrap transition ${
              selectedStatus === tab.value
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>}

      {/* Quotation Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
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
                  <td className="px-6 py-4 font-medium text-gray-900">{q.customer_name}</td>
                  <td className="px-6 py-4 text-gray-600">{q.sales_rep_name || "-"}</td>
                  <td className="px-6 py-4 font-bold text-gray-700">{q.currency_code}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded ${
                        q.status === "APPROVED"
                          ? "bg-green-100 text-green-800"
                          : q.status === "PENDING_APPROVAL"
                          ? "bg-yellow-100 text-yellow-800"
                          : q.status === "CONFIRMED"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {q.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-gray-900">
                    {q.currency_code} {Number(q.grand_total).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right font-semibold text-blue-700">
                    {Number(q.margin_pct).toFixed(1)}%
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/internal/quotations/${q.id}`}
                      className="text-blue-600 hover:text-blue-900 font-medium text-xs"
                    >
                      Edit & Lines →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="px-6 py-3 flex items-center justify-between border-t border-gray-200 bg-gray-50 text-sm text-gray-500">
          <div>Showing {quotations.length} of {total} quotations</div>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1 border rounded bg-white disabled:opacity-50"
            >
              Previous
            </button>
            <span className="py-1">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1 border rounded bg-white disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-lg font-bold mb-4">Create New Quotation</h2>
            <form onSubmit={handleCreateQuotation} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Select Customer</label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 text-sm"
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
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes / Terms</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  placeholder="Optional internal deal notes"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border rounded text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                  Create Quote
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
