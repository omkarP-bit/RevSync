"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";

interface QuotationLine {
  id: number;
  quotation_id: number;
  product_id: number;
  product_name: string;
  product_sku: string;
  description?: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  applied_discount_pct: number;
  discount_amount: number;
  line_subtotal: number;
  line_total: number;
  line_cost: number;
  line_margin: number;
}

interface DiscountAnalysisLine {
  id: number | null;
  product_id: number;
  product_name: string | null;
  category_id: number;
  applied_discount_pct: number;
  allowed_discount_pct: number;
  line_overage: number;
  is_flagged: boolean;
  reason: string | null;
}

interface DiscountAnalysis {
  lines: DiscountAnalysisLine[];
  total_allowed_discount_amount: number;
  total_applied_discount_amount: number;
  total_overage: number;
}

interface QuotationDetail {
  id: number;
  quotation_number: string;
  public_id: string;
  customer_id: number;
  customer_name: string;
  customer_tier_id: number;
  tier_name: string;
  sales_rep_id: number;
  sales_rep_name: string;
  currency_code: string;
  status: string;
  subtotal: number;
  discount_total: number;
  tax_rate_pct: number;
  tax_total: number;
  grand_total: number;
  total_cost: number;
  margin_amount: number;
  margin_pct: number;
  risk_level: string;
  total_overage: number;
  notes?: string;
  discount_analysis?: DiscountAnalysis;
  lines: QuotationLine[];
}

interface Product {
  id: number;
  name: string;
  sku: string;
}

const SAMPLE_UPSELLS = [
  { id: 2, name: "24/7 Cloud Operations Support", sku: "CS-SUPP-001", promo: "Margin +$32" },
  { id: 3, name: "IoT Edge Gateway Hardware", sku: "HW-EDGE-001", promo: "Promo: 10% off" },
  { id: 1, name: "RevSync Enterprise License", sku: "SW-ENT-001", promo: "Margin +$150" },
];

export default function QuotationDetailBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const quoteId = params?.id as string;

  const [quote, setQuote] = useState<QuotationDetail | null>(null);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add Line Modal / Quick Selector
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<number>(0);
  const [lineQty, setLineQty] = useState<number>(1);
  const [lineDiscount, setLineDiscount] = useState<number>(0);

  const fetchQuote = async () => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}`);
      setQuote(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load quotation detail");
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await api.get<ApiResponse<Product[]>>("/api/v1/products", { limit: "100" });
      setAvailableProducts(res.data);
      if (res.data.length > 0) setSelectedProductId(res.data[0].id);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (quoteId) {
      fetchQuote();
      fetchProducts();
    }
  }, [quoteId]);

  const handleAddLineItem = async (productId: number, qty: number = 1, disc: number = 0) => {
    try {
      const res = await api.post<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}/lines`, {
        product_id: productId,
        quantity: qty,
        applied_discount_pct: disc,
      });

      setQuote(res.data);
      setShowAddModal(false);
      setLineQty(1);
      setLineDiscount(0);
    } catch (err: any) {
      alert(err.message || "Failed to add line item");
    }
  };

  const handleUpdateLine = async (lineId: number, qty: number, disc: number) => {
    try {
      const res = await api.patch<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}/lines/${lineId}`, {
        quantity: qty,
        applied_discount_pct: disc,
      });
      setQuote(res.data);
    } catch (err: any) {
      alert(err.message || "Failed to update line item");
    }
  };

  const handleDeleteLine = async (lineId: number) => {
    if (!confirm("Are you sure you want to remove this line item?")) return;
    try {
      const res = await api.request<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}/lines/${lineId}`, {
        method: "DELETE",
      });
      setQuote(res.data);
    } catch (err: any) {
      alert(err.message || "Failed to delete line item");
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      const res = await api.patch<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}`, {
        status: newStatus,
      });
      setQuote(res.data);
      alert(`Quotation status updated to ${newStatus}`);
    } catch (err: any) {
      alert(err.message || "Failed to update quotation status");
    }
  };

  const handleSubmitApproval = async () => {
    try {
      const res = await api.post<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}/submit`, {});
      setQuote(res.data);
      alert("Quotation submitted for approval!");
    } catch (err: any) {
      alert(err.message || "Failed to submit for approval");
    }
  };

  if (loading) return <div className="p-8 text-slate-500 font-medium">Loading quotation builder...</div>;
  if (error || !quote) return <div className="p-8 text-rose-600 font-bold">{error || "Quotation not found"}</div>;

  return (
    <div className="w-full space-y-6">
      {/* Top Breadcrumb */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <Link href="/internal/quotations" className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1">
          ← Back to Quotations List
        </Link>
        <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded border border-blue-200">
          Status: {quote.status}
        </span>
      </div>

      {/* Screen Title & Subtitle */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          Quotation Detail: {quote.quotation_number} ({quote.customer_name})
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Opened by clicking a row on the Quotations list. Add products, apply discounts, review upsells.
        </p>
      </div>

      {/* Customer & Price List Header Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Customer</label>
          <div className="text-sm font-extrabold text-slate-900">{quote.customer_name}</div>
          <div className="text-xs text-slate-500">Sales Rep: {quote.sales_rep_name}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Price List / Tier</label>
          <div className="text-sm font-extrabold text-slate-900">{quote.tier_name} Tier ({quote.currency_code})</div>
          <div className="text-xs text-slate-500">Tax Rate: {Number(quote.tax_rate_pct)}%</div>
        </div>
      </div>

      {/* Product Line Items Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-extrabold text-slate-800 text-sm">Product Lines ({quote.lines?.length || 0})</h2>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 text-xs font-semibold shadow-xs"
          >
            + Add Product Line
          </button>
        </div>

        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-100/70 text-slate-600 font-bold uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left">Product</th>
              <th className="px-4 py-3 text-center w-24">Qty</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-center w-24">Discount</th>
              <th className="px-4 py-3 text-center w-32">Limit / Status</th>
              <th className="px-4 py-3 text-right">Line Total</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {(quote.lines || []).length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No line items added yet. Click &quot;+ Add Product Line&quot; to begin building this quotation.
                </td>
              </tr>
            ) : (
              (quote.lines || []).map((line) => {
                const policy = quote.discount_analysis?.lines?.find((l) => l.id === line.id || l.product_id === line.product_id);
                const discPct = Number(line.applied_discount_pct || 0);
                const allowedPct = policy ? Number(policy.allowed_discount_pct) : 15;
                const isOver = policy ? policy.is_flagged : discPct > allowedPct;

                return (
                  <tr key={line.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{line.product_name}</div>
                      <div className="font-mono text-slate-400 text-[10px]">{line.product_sku}</div>
                    </td>

                    {/* Qty Input */}
                    <td className="px-4 py-3 text-center">
                      <input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) =>
                          handleUpdateLine(
                            line.id,
                            parseInt(e.target.value) || 1,
                            line.applied_discount_pct
                          )
                        }
                        className="w-16 border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </td>

                    {/* Price */}
                    <td className="px-4 py-3 text-right font-semibold text-slate-800 font-mono">
                      {quote.currency_code} {Number(line.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>

                    {/* Discount Input */}
                    <td className="px-4 py-3 text-center">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={line.applied_discount_pct}
                        onChange={(e) =>
                          handleUpdateLine(
                            line.id,
                            line.quantity,
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="w-16 border border-slate-300 rounded px-2 py-1 text-center font-bold text-amber-600 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </td>

                    {/* Limit / Status */}
                    <td className="px-4 py-3 text-center">
                      {isOver ? (
                        <span className="inline-block bg-amber-100 text-amber-900 border border-amber-300 font-extrabold px-2 py-0.5 rounded text-[10px]">
                          OVER (+{discPct - allowedPct}pt)
                        </span>
                      ) : (
                        <span className="inline-block bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold px-2 py-0.5 rounded text-[10px]">
                          OK
                        </span>
                      )}
                    </td>

                    {/* Line Total */}
                    <td className="px-4 py-3 text-right font-extrabold text-slate-900 font-mono">
                      {quote.currency_code} {Number(line.line_total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDeleteLine(line.id)}
                        className="text-rose-600 hover:text-rose-800 font-semibold"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Live Amber Banner Notice */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs font-semibold flex items-center gap-2">
        <span className="text-base">⚡</span>
        <span>Discount is checked against each line&apos;s own limit live, as soon as it is entered, not only at submit time.</span>
      </div>

      {/* Upsell and Cross-Sell Suggestions Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-extrabold text-blue-900 tracking-tight">Upsell and Cross-Sell Suggestions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SAMPLE_UPSELLS.map((rec) => (
            <div
              key={rec.id}
              onClick={() => handleAddLineItem(rec.id, 1, 0)}
              className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 shadow-sm hover:border-blue-500 hover:scale-[1.01] transition cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="font-bold text-sm text-slate-100">+ {rec.name}</div>
                <div className="text-xs text-blue-400 mt-1 font-semibold">{rec.promo}</div>
              </div>
              <div className="mt-3 text-[11px] font-semibold text-slate-400 text-right group-hover:text-blue-300">
                Click to add to quote &rarr;
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Totals Summary Footer & Action Buttons */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-6 text-xs">
          <div>
            <span className="text-slate-500 block">Subtotal</span>
            <span className="font-bold text-slate-900">{quote.currency_code} {Number(quote.subtotal).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-slate-500 block">Discount Total</span>
            <span className="font-bold text-amber-600">-{quote.currency_code} {Number(quote.discount_total).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-slate-500 block">Grand Total</span>
            <span className="text-base font-extrabold text-blue-700">{quote.currency_code} {Number(quote.grand_total).toFixed(2)}</span>
          </div>
        </div>

        {/* Action Buttons matching mockup */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleStatusChange("DRAFT")}
            className="px-5 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
          >
            Save Draft
          </button>
          <button
            onClick={handleSubmitApproval}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition shadow-xs"
          >
            Submit for Approval
          </button>
        </div>
      </div>

      {/* Add Line Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl border border-slate-100">
            <h2 className="text-lg font-extrabold text-slate-900 mb-4">Add Product Line</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddLineItem(selectedProductId, lineQty, lineDiscount);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Product</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                >
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={lineQty}
                    onChange={(e) => setLineQty(parseInt(e.target.value) || 1)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Discount (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={lineDiscount}
                    onChange={(e) => setLineDiscount(parseFloat(e.target.value) || 0)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 shadow-xs">
                  Add to Quote
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
