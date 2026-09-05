"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";
import { exportInvoicePdf } from "@/lib/pdf";
import { useCurrency } from "@/components/CurrencyProvider";

interface InvoiceLine {
  id: number;
  quotation_line_id: number | null;
  product_id: number;
  product_name: string;
  sku: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  applied_discount_pct: number;
  discount_amount: number;
  line_subtotal: number;
  line_total: number;
}

interface Payment {
  id: number;
  reference: string;
  amount_paid: number;
  payment_date: string;
  payment_method: string;
  notes: string | null;
}

interface CreditNote {
  id: number;
  credit_note_number: string;
  amount: number;
  reason: string;
  status: string;
  created_at: string;
}

interface InvoiceDetail {
  id: number;
  invoice_number: string;
  quotation_id: number;
  customer_id: number;
  customer_name: string;
  quotation_number: string;
  currency_code: string;
  status: string;
  issue_date: string;
  due_date: string;
  subtotal: number;
  discount_total: number;
  order_discount_pct: number;
  order_discount_amount: number;
  tax_rate_pct: number;
  tax_total: number;
  grand_total: number;
  total_paid: number;
  notes: string | null;
  lines: InvoiceLine[];
  payments: Payment[];
  credit_notes: CreditNote[];
}

const statusStyles: Record<string, string> = {
  ISSUED: "bg-blue-100 text-blue-800",
  PARTIALLY_PAID: "bg-yellow-100 text-yellow-800",
  PAID: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-600",
};

const paymentMethods = ["CASH", "BANK_TRANSFER", "CARD", "CHECK", "CREDIT_WALLET", "OTHER"];

export default function InvoiceDetailPage() {
  const params = useParams();
  const invoiceId = params?.id as string;

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [userRoleId, setUserRoleId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);

  const [showPayment, setShowPayment] = useState(false);
  const [payRef, setPayRef] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("BANK_TRANSFER");
  const [payNotes, setPayNotes] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [showCreditNote, setShowCreditNote] = useState(false);
  const [cnAmount, setCnAmount] = useState("");
  const [cnReason, setCnReason] = useState("");
  const { format } = useCurrency();

  const canManage = userRoleId === 3 || userRoleId === 5;

  const fetchInvoice = async () => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<InvoiceDetail>>(`/api/v1/invoices/${invoiceId}`);
      setInvoice(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load invoice");
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
    if (invoiceId) fetchInvoice();
  }, [invoiceId]);

  const action = async (fn: () => Promise<void>, actionName: string) => {
    setActing(true);
    try {
      await fn();
      await fetchInvoice();
    } catch (err: any) {
      alert(err.message || `Failed to ${actionName}`);
    } finally {
      setActing(false);
    }
  };

  if (loading) return <div className="p-6 text-gray-500">Loading invoice...</div>;
  if (error || !invoice) return <div className="p-6 text-red-600">{error || "Invoice not found"}</div>;

  const balanceDue = Number(invoice.grand_total) - Number(invoice.total_paid);
  const locked = invoice.status === "PAID" || invoice.status === "CANCELLED";

  const recordPayment = () => {
    if (!invoice) return;
    const body: Record<string, unknown> = {
      reference: payRef,
      amount_paid: Number(payAmount),
      payment_method: payMethod,
      notes: payNotes || null,
    };
    if (payDate) body.payment_date = new Date(payDate).toISOString();

    action(() => api.post(`/api/v1/invoices/${invoiceId}/payments`, body), "record payment");
    setShowPayment(false);
    setPayRef("");
    setPayAmount("");
    setPayMethod("BANK_TRANSFER");
    setPayNotes("");
  };

  const issueCreditNote = () => {
    if (!invoice) return;
    action(
      () =>
        api.post("/api/v1/credit-notes", {
          invoice_id: invoice.id,
          customer_id: invoice.customer_id,
          amount: Number(cnAmount),
          reason: cnReason,
        }),
      "issue credit note"
    );
    setShowCreditNote(false);
    setCnAmount("");
    setCnReason("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/internal/invoices" className="text-gray-500 hover:text-gray-700 text-sm">
            ← Back to Invoices
          </Link>
          <span className="text-gray-300">|</span>
          <span className="font-mono text-xs font-bold text-blue-700">
            {invoice.invoice_number}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 text-xs font-semibold rounded ${statusStyles[invoice.status] || "bg-gray-100 text-gray-700"}`}>
            {invoice.status}
          </span>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{invoice.customer_name}</h1>
            <p className="text-xs text-gray-500 mt-1">
              Issued {new Date(invoice.issue_date).toLocaleDateString()} · Due {new Date(invoice.due_date).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportInvoicePdf(invoice)}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 text-sm font-medium"
            >
              ⬇ Export PDF
            </button>
            <Link
              href={`/internal/quotations/${invoice.quotation_id}`}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
            >
              Open Quotation →
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100 text-xs">
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Quotation</span>
            <span className="font-mono font-bold text-gray-900">{invoice.quotation_number}</span>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Grand Total</span>
            <span className="text-sm font-bold text-gray-900">
              {format(invoice.grand_total)}
            </span>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Paid</span>
            <span className="text-sm font-bold text-green-600">
              {format(invoice.total_paid)}
            </span>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Balance Due</span>
            <span className="text-sm font-bold text-red-600">
              {format(balanceDue)}
            </span>
          </div>
        </div>

        {invoice.notes && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800">
            <span className="font-semibold">Notes:</span> {invoice.notes}
          </div>
        )}
      </div>

      {/* Line Items */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Line Items</h2>
        {invoice.lines.length === 0 ? (
          <p className="text-sm text-gray-500">No line items on this invoice.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Product</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Unit Price</th>
                <th className="px-4 py-2 text-right">Discount %</th>
                <th className="px-4 py-2 text-right">Line Subtotal</th>
                <th className="px-4 py-2 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{line.product_name}</div>
                    <div className="text-xs text-gray-400 font-mono">{line.sku}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{line.quantity}</td>
                  <td className="px-4 py-3 text-right">
                    {format(line.unit_price)}
                  </td>
                  <td className="px-4 py-3 text-right">{Number(line.applied_discount_pct).toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {format(line.line_subtotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {format(line.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex justify-end pt-4 border-t border-gray-100 text-sm space-y-1 flex-col items-end">
          <div className="text-gray-600">
            Subtotal: {format(invoice.subtotal)}
          </div>
          <div className="text-gray-600">
            Line Discounts: −{format(invoice.discount_total - invoice.order_discount_amount)}
          </div>
          <div className="text-gray-600">
            Order Discount ({Number(invoice.order_discount_pct).toFixed(1)}%): −{format(invoice.order_discount_amount)}
          </div>
          <div className="text-gray-600">
            Tax ({Number(invoice.tax_rate_pct).toFixed(1)}%): {format(invoice.tax_total)}
          </div>
          <div className="font-bold text-gray-900">
            Grand Total: {format(invoice.grand_total)}
          </div>
        </div>
      </div>

      {/* Payments */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Payments</h2>
          {canManage && !locked && (
            <button
              onClick={() => setShowPayment(true)}
              className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700"
            >
              + Record Payment
            </button>
          )}
        </div>
        {invoice.payments.length === 0 ? (
          <p className="text-sm text-gray-500">No payments recorded yet.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Reference</th>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">Method</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {invoice.payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-mono text-gray-700">{p.reference}</td>
                  <td className="px-4 py-3">{new Date(p.payment_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{p.payment_method}</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-600">
                    {format(p.amount_paid)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{p.notes ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Credit Notes */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Credit Notes</h2>
          {canManage && !locked && (
            <button
              onClick={() => setShowCreditNote(true)}
              className="px-3 py-1.5 border border-blue-300 text-blue-700 bg-white rounded-md text-sm font-medium hover:bg-blue-50"
            >
              + Issue Credit Note
            </button>
          )}
        </div>
        {invoice.credit_notes.length === 0 ? (
          <p className="text-sm text-gray-500">No credit notes issued.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Credit Note</th>
                <th className="px-4 py-2 text-left">Reason</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {invoice.credit_notes.map((cn) => (
                <tr key={cn.id}>
                  <td className="px-4 py-3 font-mono text-gray-700">{cn.credit_note_number}</td>
                  <td className="px-4 py-3 text-gray-700">{cn.reason}</td>
                  <td className="px-4 py-3 text-right font-semibold text-red-600">
                    {format(cn.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded bg-purple-100 text-purple-800`}>
                      {cn.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Cancel */}
      {canManage && !locked && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex justify-end">
          <button
            disabled={acting}
            onClick={() => action(() => api.post(`/api/v1/invoices/${invoiceId}/cancel`), "cancel invoice")}
            className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {acting ? "Working..." : "Cancel Invoice"}
          </button>
        </div>
      )}

      {/* Record Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Record Payment</h2>
              <button onClick={() => setShowPayment(false)} className="text-gray-400 hover:text-gray-600 text-xl">
                ×
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Reference (idempotent key)</label>
              <input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="e.g. PAY-2026-0001"
                className="border rounded px-2 py-2 text-sm w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
                <input
                  type="number"
                  min={0.01}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0.00"
                  className="border rounded px-2 py-2 text-sm w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="border rounded px-2 py-2 text-sm w-full"
                >
                  {paymentMethods.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Payment Date</label>
              <input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="border rounded px-2 py-2 text-sm w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <textarea
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                rows={2}
                className="border rounded px-2 py-2 text-sm w-full"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowPayment(false)}
                className="px-3 py-2 text-sm text-gray-600 border rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={recordPayment}
                disabled={!payRef || !payAmount}
                className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                Record Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credit Note Modal */}
      {showCreditNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Issue Credit Note</h2>
              <button onClick={() => setShowCreditNote(false)} className="text-gray-400 hover:text-gray-600 text-xl">
                ×
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
              <input
                type="number"
                min={0.01}
                value={cnAmount}
                onChange={(e) => setCnAmount(e.target.value)}
                placeholder="0.00"
                className="border rounded px-2 py-2 text-sm w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Reason</label>
              <textarea
                value={cnReason}
                onChange={(e) => setCnReason(e.target.value)}
                rows={3}
                placeholder="e.g. Customer returned defective hardware"
                className="border rounded px-2 py-2 text-sm w-full"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreditNote(false)}
                className="px-3 py-2 text-sm text-gray-600 border rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={issueCreditNote}
                disabled={!cnAmount || !cnReason}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Issue Credit Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}