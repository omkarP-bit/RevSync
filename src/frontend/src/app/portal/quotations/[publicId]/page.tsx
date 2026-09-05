"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";
import Link from "next/link";

interface QuotationLine {
  id: number;
  product_id: number;
  product_name: string;
  sku: string;
  description: string;
  billing_model: string;
  billing_interval: string | null;
  quantity: number;
  unit_price: number;
  applied_discount_pct: number;
  discount_amount: number;
  line_subtotal: number;
  line_total: number;
}

interface QuotationDetail {
  id: number;
  public_id: string;
  quotation_number: string;
  revision_number: number;
  customer_id: number;
  customer_name: string;
  currency_code: string;
  status: string;
  payment_terms: string;
  tax_rate_pct: number;
  order_discount_pct: number;
  order_discount_amount: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  valid_until: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  lines: QuotationLine[];
}

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "bg-blue-100 text-blue-800",
  SENT: "bg-indigo-100 text-indigo-800",
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
  EXPIRED: "bg-gray-100 text-gray-700",
  DRAFT: "bg-amber-100 text-amber-800",
};

export default function CanonicalQuotationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const publicId = params.publicId as string;

  const [quote, setQuote] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Confirmation Modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  const loadQuote = useCallback(async () => {
    try {
      const res = await api.get<ApiResponse<QuotationDetail>>(`/api/v1/portal/quotations/${publicId}`);
      setQuote(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load quotation detail");
    } finally {
      setLoading(false);
    }
  }, [publicId]);

  useEffect(() => {
    if (publicId) {
      loadQuote();
    }
  }, [publicId, loadQuote]);

  const handleConfirmSubmit = async () => {
    if (!agreedTerms) {
      setConfirmError("Please accept the terms before confirming.");
      return;
    }

    setConfirmError("");
    setConfirming(true);

    try {
      await api.post(`/api/v1/portal/quotations/${publicId}/confirm`, {});
      setShowConfirmModal(false);
      await loadQuote();
    } catch (err: any) {
      setConfirmError(err.message || "Failed to confirm quotation.");
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-sm text-gray-500">Loading proposal details...</div>;
  }

  if (error || !quote) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold">
        {error || "Quotation not found."}
      </div>
    );
  }

  const isConfirmable = quote.status === "APPROVED" || quote.status === "SENT";
  const isConfirmed = quote.status === "CONFIRMED";

  return (
    <div className="w-full space-y-6">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center justify-between text-xs text-gray-500 font-semibold">
        <Link href="/portal/quotations" className="hover:text-indigo-600 flex items-center gap-1">
          &larr; Back to Quotations
        </Link>
        <span>Reference: {quote.public_id}</span>
      </div>

      {/* Confirmation Banner */}
      {isConfirmed && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-xl">✅</span>
            <div>
              <p className="text-xs font-bold">Quotation Confirmed</p>
              <p className="text-[11px] text-emerald-700 mt-0.5">
                Confirmed on {quote.confirmed_at ? new Date(quote.confirmed_at).toLocaleString() : "record"}. Subscriptions and orders have been executed.
              </p>
            </div>
          </div>
          <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-black rounded-full uppercase">
            CONFIRMED
          </span>
        </div>
      )}

      {/* Main Header Card */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-3xl font-black text-gray-900 font-mono tracking-tight">{quote.quotation_number}</h1>
            <span className={`px-3 py-1 text-xs font-black rounded-full ${STATUS_BADGE[quote.status] || "bg-gray-100 text-gray-700"}`}>
              {quote.status}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-2 font-medium">
            Customer: <span className="font-bold text-gray-800">{quote.customer_name}</span> • Payment Terms: <span className="font-bold text-gray-800">{quote.payment_terms}</span> • Valid Until: <span className="font-bold text-gray-800">{quote.valid_until ? new Date(quote.valid_until).toLocaleDateString() : "N/A"}</span>
          </p>
        </div>

        {/* Action Buttons */}
        {isConfirmable && (
          <div className="flex items-center space-x-3 w-full md:w-auto">
            <Link
              href={`/portal/negotiations/${quote.public_id}`}
              className="flex-1 md:flex-none text-center px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-xl transition-colors"
            >
              Request Changes
            </Link>
            <button
              onClick={() => {
                setAgreedTerms(false);
                setConfirmError("");
                setShowConfirmModal(true);
              }}
              className="flex-1 md:flex-none px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
            >
              Confirm Quotation
            </button>
          </div>
        )}
      </div>

      {/* Line Items Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">Quotation Line Items</h2>
        </div>
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase font-semibold">
            <tr>
              <th className="px-6 py-3 text-left">Product / Description</th>
              <th className="px-6 py-3 text-left">Billing Model</th>
              <th className="px-6 py-3 text-center">Qty</th>
              <th className="px-6 py-3 text-right">Unit Price</th>
              <th className="px-6 py-3 text-right">Discount</th>
              <th className="px-6 py-3 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100 text-xs font-medium">
            {quote.lines.map((l) => {
              const model = (l as any).product_type || l.billing_model || "ONE_TIME";
              const badgeStyle =
                model === "SUBSCRIPTION" || model === "RECURRING"
                  ? "bg-purple-100 text-purple-800"
                  : model === "SOFTWARE"
                  ? "bg-emerald-100 text-emerald-800"
                  : model === "SERVICES"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-blue-100 text-blue-800";

              return (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="font-bold text-gray-900">{l.product_name}</p>
                    <p className="text-[11px] font-mono text-gray-400">{l.sku}</p>
                    {l.description && <p className="text-[11px] text-gray-500 mt-0.5">{l.description}</p>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full ${badgeStyle}`}>
                      {model} {l.billing_interval ? `(${l.billing_interval})` : ""}
                    </span>
                  </td>
                <td className="px-6 py-4 text-center font-bold text-gray-800">{l.quantity}</td>
                <td className="px-6 py-4 text-right text-gray-600">{quote.currency_code} {Number(l.unit_price).toFixed(2)}</td>
                <td className="px-6 py-4 text-right text-amber-600 font-semibold">
                  {l.applied_discount_pct > 0 ? `${l.applied_discount_pct}%` : "—"}
                </td>
                <td className="px-6 py-4 text-right font-extrabold text-gray-900">
                  {quote.currency_code} {Number(l.line_total).toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>

      {/* Financial Summary Box */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs max-w-md ml-auto space-y-2 text-xs">
        <div className="flex justify-between text-gray-600">
          <span>Subtotal</span>
          <span className="font-semibold">{quote.currency_code} {Number(quote.subtotal).toFixed(2)}</span>
        </div>
        {quote.discount_total > 0 && (
          <div className="flex justify-between text-amber-600 font-medium">
            <span>Discounts Total</span>
            <span>- {quote.currency_code} {Number(quote.discount_total).toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-gray-600">
          <span>Tax ({quote.tax_rate_pct}%)</span>
          <span className="font-semibold">{quote.currency_code} {Number(quote.tax_total).toFixed(2)}</span>
        </div>
        <div className="pt-2 border-t border-gray-200 flex justify-between text-base font-black text-gray-900">
          <span>Grand Total</span>
          <span className="text-indigo-600">{quote.currency_code} {Number(quote.grand_total).toFixed(2)}</span>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-200">
            <h3 className="text-lg font-extrabold text-gray-900">Confirm Quotation {quote.quotation_number}</h3>
            
            {confirmError && (
              <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-semibold">
                {confirmError}
              </div>
            )}

            <div className="bg-gray-50 p-4 rounded-xl text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Total Commitment:</span>
                <span className="font-bold text-gray-900">{quote.currency_code} {Number(quote.grand_total).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Payment Terms:</span>
                <span className="font-bold text-gray-900">{quote.payment_terms}</span>
              </div>
            </div>

            <p className="text-xs text-gray-500 leading-relaxed">
              By confirming this proposal, you authorize RevSync to create orders and active recurring subscriptions according to the specified line item terms.
            </p>

            <label className="flex items-start space-x-2.5 cursor-pointer pt-2">
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs font-semibold text-gray-700">
                I agree to the proposal terms and authorize order execution.
              </span>
            </label>

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={confirming}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={confirming || !agreedTerms}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs disabled:opacity-50"
              >
                {confirming ? "Processing Confirmation..." : "Confirm & Execute Order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
