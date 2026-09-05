"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";
import { useCurrency } from "@/components/CurrencyProvider";

interface Invoice {
  id: number;
  invoice_number: string;
  public_id: string;
  customer_id: number;
  customer_name: string;
  quotation_number: string;
  status: string;
  issue_date: string;
  due_date: string;
  grand_total: number;
  total_paid: number;
  balance_due: number;
  created_at: string;
}

interface BillableQuotation {
  id: number;
  quotation_number: string;
  currency_code: string;
  grand_total: number;
  customer_name: string;
  created_at: string;
}

const statusTabs = [
  { label: "All", value: "" },
  { label: "Issued", value: "ISSUED" },
  { label: "Partial", value: "PARTIALLY_PAID" },
  { label: "Paid", value: "PAID" },
  { label: "Cancelled", value: "CANCELLED" },
];

const statusStyles: Record<string, string> = {
  ISSUED: "bg-blue-100 text-blue-800",
  PARTIALLY_PAID: "bg-yellow-100 text-yellow-800",
  PAID: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-600",
};

export default function InvoicesListPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedStatus, setSelectedStatus] = useState("");
  const [userRoleId, setUserRoleId] = useState<number | null>(null);

  // Generate-invoice modal state
  const [showGenerate, setShowGenerate] = useState(false);
  const [billable, setBillable] = useState<BillableQuotation[]>([]);
  const [loadingBillable, setLoadingBillable] = useState(false);
  const [generating, setGenerating] = useState<number | null>(null);
  const { format } = useCurrency();

  const canManage = userRoleId === 3 || userRoleId === 5;

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: page.toString(), limit: "10" };
      if (selectedStatus) params.status = selectedStatus;

      const res = await api.get<ApiResponse<Invoice[]>>("/api/v1/invoices", params);
      setInvoices(res.data);
      if (res.meta) {
        setTotalPages(res.meta.total_pages);
        setTotal(res.meta.total);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) {
      try {
        setUserRoleId(JSON.parse(stored).role_id ?? null);
      } catch {
        setUserRoleId(null);
      }
    }
    fetchInvoices();
  }, [page, selectedStatus]);

  const loadBillable = async () => {
    setShowGenerate(true);
    setLoadingBillable(true);
    try {
      const res = await api.get<ApiResponse<BillableQuotation[]>>("/api/v1/invoices/billable-quotations");
      setBillable(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load billable quotations");
    } finally {
      setLoadingBillable(false);
    }
  };

  const generateInvoice = async (quotationId: number) => {
    setGenerating(quotationId);
    try {
      await api.post("/api/v1/invoices", { quotation_id: quotationId });
      setShowGenerate(false);
      setSelectedStatus("");
      setPage(1);
      await fetchInvoices();
      alert("Invoice generated.");
    } catch (err: any) {
      alert(err.message || "Failed to generate invoice");
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500">
            Invoices generated from confirmed quotations and their payment status.
          </p>
        </div>
        {canManage && (
          <button
            onClick={loadBillable}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
          >
            + Generate Invoice
          </button>
        )}
      </div>

      {/* Status Filter Tabs */}
      <div className="flex border-b border-gray-200 gap-2 overflow-x-auto text-sm">
        {statusTabs.map((tab) => (
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

      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-6 py-3 text-left">Invoice</th>
              <th className="px-6 py-3 text-left">Customer</th>
              <th className="px-6 py-3 text-left">Quote</th>
              <th className="px-6 py-3 text-right">Grand Total</th>
              <th className="px-6 py-3 text-right">Paid</th>
              <th className="px-6 py-3 text-right">Balance Due</th>
              <th className="px-6 py-3 text-left">Due Date</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200 text-sm">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-6 py-6 text-center text-gray-500">
                  Loading invoices...
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-6 text-center text-gray-500">
                  No invoices found for this filter.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-mono font-bold text-blue-700">{inv.invoice_number}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">{inv.customer_name}</td>
                  <td className="px-6 py-4 font-mono text-gray-600">{inv.quotation_number}</td>
                  <td className="px-6 py-4 text-right font-bold text-gray-900">
                    {format(inv.grand_total)}
                  </td>
                  <td className="px-6 py-4 text-right text-green-600">
                    {format(inv.total_paid)}
                  </td>
                  <td className="px-6 py-4 text-right font-semibold text-red-600">
                    {format(inv.balance_due)}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {new Date(inv.due_date).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded ${statusStyles[inv.status] || "bg-gray-100 text-gray-700"}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link href={`/internal/invoices/${inv.id}`} className="text-blue-600 hover:text-blue-900 font-medium text-xs">
                      View →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="px-6 py-3 flex items-center justify-between border-t border-gray-200 bg-gray-50 text-sm text-gray-500">
          <div>Showing {invoices.length} of {total} invoices</div>
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

      {/* Generate Invoice Modal */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Generate Invoice from Quotation</h2>
              <button onClick={() => setShowGenerate(false)} className="text-gray-400 hover:text-gray-600 text-xl">
                ×
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              {loadingBillable ? (
                <p className="text-sm text-gray-500">Loading billable quotations...</p>
              ) : billable.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No confirmed quotations available to invoice.
                </p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Quote</th>
                      <th className="px-4 py-2 text-left">Customer</th>
                      <th className="px-4 py-2 text-right">Total</th>
                      <th className="px-4 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {billable.map((q) => (
                      <tr key={q.id}>
                        <td className="px-4 py-3 font-mono text-blue-700">{q.quotation_number}</td>
                        <td className="px-4 py-3 text-gray-900">{q.customer_name}</td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {format(q.grand_total)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => generateInvoice(q.id)}
                            disabled={generating === q.id}
                            className="px-3 py-1 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                          >
                            {generating === q.id ? "Generating..." : "Invoice"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}