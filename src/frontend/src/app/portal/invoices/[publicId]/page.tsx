"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";
import { exportPortalInvoicePdf } from "@/lib/pdf";

interface PortalInvoiceLine {
  product_name: string;
  sku: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  applied_discount_pct: number;
  discount_amount: number;
  line_total: number;
}

interface PortalInvoicePayment {
  reference: string;
  amount_paid: number;
  payment_method: string;
  payment_date: string;
}

interface PortalInvoiceDetail {
  invoice_number: string;
  quotation_number: string;
  currency_code?: string;
  status: string;
  issue_date: string;
  due_date: string;
  grand_total: number;
  total_paid: number;
  balance_due: number;
  lines: PortalInvoiceLine[];
  payments: PortalInvoicePayment[];
}

const STATUS_BADGE: Record<string, string> = {
  ISSUED: "bg-blue-100 text-blue-800",
  PARTIALLY_PAID: "bg-yellow-100 text-yellow-800",
  PAID: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-700",
};

export default function PortalInvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const publicId = params?.publicId as string;

  const [invoice, setInvoice] = useState<PortalInvoiceDetail | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [applyingWallet, setApplyingWallet] = useState(false);
  const [walletSuccess, setWalletSuccess] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [invRes, walletRes] = await Promise.all([
        api.get<ApiResponse<PortalInvoiceDetail>>(`/api/v1/portal/invoices/${publicId}`),
        api.get<ApiResponse<{ balance: number }>>(`/api/v1/portal/wallet`).catch(() => ({ data: { balance: 0 } })),
      ]);
      setInvoice(invRes.data);
      setWalletBalance(Number(walletRes.data?.balance || 0));
    } catch (err: any) {
      setError(err.message || "Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [publicId]);

  useEffect(() => {
    if (publicId) load();
  }, [publicId, load]);

  const handleApplyWallet = async () => {
    if (!invoice) return;
    setApplyingWallet(true);
    setWalletSuccess("");
    setError("");
    try {
      const res = await api.post<ApiResponse<{ applied_amount: number }>>(`/api/v1/portal/invoices/${publicId}/apply-wallet`, {});
      setWalletSuccess(`Successfully applied ${invoice.currency_code || "USD"} ${Number(res.data.applied_amount).toFixed(2)} from your Credit Wallet!`);
      await load();
    } catch (err: any) {
      setError(err.message || "Failed to apply credit wallet");
    } finally {
      setApplyingWallet(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Loading invoice...</div>;
  if (error && !invoice) return <div className="p-8 text-center text-sm text-red-600">{error}</div>;
  if (!invoice) return <div className="p-8 text-center text-sm text-gray-500">Invoice not found</div>;

  const currency = invoice.currency_code || "USD";

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/portal/invoices")} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to Invoices
        </button>
      </div>

      {walletSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl flex items-center justify-between text-xs font-bold">
          <span>✅ {walletSuccess}</span>
          <button onClick={() => setWalletSuccess("")} className="text-emerald-700 hover:text-emerald-900">✕</button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs font-bold">
          ⚠️ {error}
        </div>
      )}

      <div className="pb-2 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">{invoice.invoice_number}</h1>
          <p className="text-xs text-gray-500">
            Quote {invoice.quotation_number} · Issued {new Date(invoice.issue_date).toLocaleDateString()} · Due {new Date(invoice.due_date).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportPortalInvoicePdf(invoice)}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 text-sm font-medium"
          >
            ⬇ Export PDF
          </button>
          <span className={`px-2 py-1 text-xs font-bold rounded-full ${STATUS_BADGE[invoice.status] || "bg-gray-100 text-gray-700"}`}>
            {invoice.status}
          </span>
        </div>
      </div>

      {/* Credit Wallet Payment Callout */}
      {invoice.balance_due > 0 && walletBalance > 0 && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">💳</span>
            <div>
              <p className="text-xs font-extrabold text-emerald-900 uppercase tracking-wide">Credit Wallet Available</p>
              <p className="text-xs text-emerald-700 font-medium">
                You have <span className="font-bold text-emerald-900">{currency} {walletBalance.toFixed(2)}</span> in your credit wallet. You can apply it to pay this invoice balance.
              </p>
            </div>
          </div>
          <button
            onClick={handleApplyWallet}
            disabled={applyingWallet}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {applyingWallet ? "Applying Credit..." : `Pay with Credit Wallet (${currency} ${Math.min(walletBalance, invoice.balance_due).toFixed(2)})`}
          </button>
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-4">
          <div className="text-xs text-gray-500 uppercase font-semibold">Grand Total</div>
          <div className="text-lg font-extrabold text-gray-900">{currency} {Number(invoice.grand_total).toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-4">
          <div className="text-xs text-gray-500 uppercase font-semibold">Paid</div>
          <div className="text-lg font-extrabold text-green-600">{currency} {Number(invoice.total_paid).toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-4">
          <div className="text-xs text-gray-500 uppercase font-semibold">Balance Due</div>
          <div className="text-lg font-extrabold text-red-600">{currency} {Number(invoice.balance_due).toFixed(2)}</div>
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 text-sm font-bold text-gray-900">Items</div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
            <tr>
              <th className="px-6 py-3 text-left">Product</th>
              <th className="px-6 py-3 text-right">Qty</th>
              <th className="px-6 py-3 text-right">Unit Price</th>
              <th className="px-6 py-3 text-right">Discount</th>
              <th className="px-6 py-3 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200 text-sm">
            {invoice.lines.map((line, idx) => (
              <tr key={idx}>
                <td className="px-6 py-4">
                  <div className="font-semibold text-gray-900">{line.product_name}</div>
                  <div className="text-xs text-gray-400 font-mono">{line.sku}</div>
                </td>
                <td className="px-6 py-4 text-right">{line.quantity}</td>
                <td className="px-6 py-4 text-right">{currency} {Number(line.unit_price).toFixed(2)}</td>
                <td className="px-6 py-4 text-right text-gray-500">
                  {Number(line.applied_discount_pct) > 0 ? `−${currency} ${Number(line.discount_amount).toFixed(2)}` : "-"}
                </td>
                <td className="px-6 py-4 text-right font-semibold text-gray-900">{currency} {Number(line.line_total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payments */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 text-sm font-bold text-gray-900">Payments</div>
        {invoice.payments.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No payments recorded yet.</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
              <tr>
                <th className="px-6 py-3 text-left">Reference</th>
                <th className="px-6 py-3 text-left">Date</th>
                <th className="px-6 py-3 text-left">Method</th>
                <th className="px-6 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200 text-sm">
              {invoice.payments.map((p, idx) => (
                <tr key={idx}>
                  <td className="px-6 py-4 font-mono text-gray-700">{p.reference}</td>
                  <td className="px-6 py-4">{new Date(p.payment_date).toLocaleDateString()}</td>
                  <td className="px-6 py-4">{p.payment_method}</td>
                  <td className="px-6 py-4 text-right font-semibold text-green-600">{currency} {Number(p.amount_paid).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}