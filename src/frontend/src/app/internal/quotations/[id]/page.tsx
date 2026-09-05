"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
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
  notes?: string;
  lines: QuotationLine[];
}

interface Product {
  id: number;
  name: string;
  sku: string;
}

export default function QuotationEditorPage() {
  const params = useParams();
  const quoteId = params?.id as string;

  const [quote, setQuote] = useState<QuotationDetail | null>(null);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add Line Modal
  const [showAddLineModal, setShowAddLineModal] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<number>(0);
  const [lineQty, setLineQty] = useState<number>(1);
  const [lineDiscount, setLineDiscount] = useState<number>(0);

  const fetchQuote = async () => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}`);
      setQuote(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load quotation");
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

  const handleAddLine = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}/lines`, {
        product_id: selectedProductId,
        quantity: lineQty,
        applied_discount_pct: lineDiscount,
      });

      setQuote(res.data);
      setShowAddLineModal(false);
      setLineQty(1);
      setLineDiscount(0);
    } catch (err: any) {
      alert(err.message || "Failed to add line");
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
      alert(err.message || "Failed to update line");
    }
  };

  const handleDeleteLine = async (lineId: number) => {
    if (!confirm("Are you sure you want to remove this line?")) return;
    try {
      const res = await api.request<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}/lines/${lineId}`, {
        method: "DELETE",
      });
      setQuote(res.data);
    } catch (err: any) {
      alert(err.message || "Failed to delete line");
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      const res = await api.patch<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}`, {
        status: newStatus,
      });
      setQuote(res.data);
    } catch (err: any) {
      alert(err.message || "Failed to update status");
    }
  };

  if (loading) return <div className="p-6 text-gray-500">Loading quotation editor...</div>;
  if (error || !quote) return <div className="p-6 text-red-600">{error || "Quotation not found"}</div>;

  return (
    <div className="space-y-6">
      {/* Top Nav & Breadcrumbs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/internal/quotations" className="text-gray-500 hover:text-gray-700 text-sm">
            ← Back to Quotations
          </Link>
          <span className="text-gray-300">|</span>
          <span className="font-mono text-xs font-bold text-blue-700">{quote.quotation_number}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Status:</label>
          <select
            value={quote.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-xs font-bold bg-white text-gray-800"
          >
            <option value="DRAFT">DRAFT</option>
            <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
            <option value="APPROVED">APPROVED</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
      </div>

      {/* Quote Summary Cards */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{quote.customer_name}</h1>
            <p className="text-xs text-gray-500 mt-1">
              Tier: <strong>{quote.tier_name}</strong> • Sales Rep: <strong>{quote.sales_rep_name}</strong> • Currency: <strong>{quote.currency_code}</strong>
            </p>
          </div>
          <button
            onClick={() => setShowAddLineModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
          >
            + Add Product Line
          </button>
        </div>

        {/* Live Calculation Metric Header */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t border-gray-100 text-xs">
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Subtotal</span>
            <span className="text-sm font-bold text-gray-900">{quote.currency_code} {Number(quote.subtotal).toFixed(2)}</span>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Discounts Total</span>
            <span className="text-sm font-bold text-red-600">-{quote.currency_code} {Number(quote.discount_total).toFixed(2)}</span>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Tax ({Number(quote.tax_rate_pct).toFixed(1)}%)</span>
            <span className="text-sm font-bold text-gray-900">+{quote.currency_code} {Number(quote.tax_total).toFixed(2)}</span>
          </div>
          <div className="bg-blue-50 p-3 rounded border border-blue-200">
            <span className="text-blue-700 font-semibold block">Grand Total</span>
            <span className="text-base font-extrabold text-blue-900">{quote.currency_code} {Number(quote.grand_total).toFixed(2)}</span>
          </div>
          <div className="bg-green-50 p-3 rounded border border-green-200">
            <span className="text-green-700 font-semibold block">Margin ({Number(quote.margin_pct).toFixed(1)}%)</span>
            <span className="text-base font-extrabold text-green-900">+{quote.currency_code} {Number(quote.margin_amount).toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Live Line Item Editor Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden space-y-3 p-6">
        <h2 className="text-lg font-bold text-gray-900">Quotation Line Items ({quote.lines.length})</h2>

        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Product SKU / Name</th>
              <th className="px-4 py-3 text-center w-28">Quantity</th>
              <th className="px-4 py-3 text-right">Unit Price</th>
              <th className="px-4 py-3 text-center w-28">Discount (%)</th>
              <th className="px-4 py-3 text-right">Line Total</th>
              <th className="px-4 py-3 text-right">Line Margin</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {quote.lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No line items added yet. Click &quot;+ Add Product Line&quot; above to add products to this quote.
                </td>
              </tr>
            ) : (
              quote.lines.map((line) => (
                <tr key={line.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-bold text-gray-900">{line.product_name}</div>
                    <div className="font-mono text-gray-500 text-[10px]">{line.product_sku}</div>
                  </td>
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
                      className="w-16 border rounded px-2 py-1 text-center font-bold text-gray-800"
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-800">
                    {quote.currency_code} {Number(line.unit_price).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={line.applied_discount_pct}
                      onChange={(e) =>
                        handleUpdateLine(
                          line.id,
                          line.quantity,
                          parseFloat(e.target.value) || 0
                        )
                      }
                      className="w-16 border rounded px-2 py-1 text-center font-bold text-red-600"
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {quote.currency_code} {Number(line.line_total).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-green-700">
                    +{quote.currency_code} {Number(line.line_margin).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDeleteLine(line.id)}
                      className="text-red-600 hover:text-red-900 font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Line Modal */}
      {showAddLineModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-lg font-bold mb-4">Add Product to Quote</h2>
            <form onSubmit={handleAddLine} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Select Product</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={lineQty}
                    onChange={(e) => setLineQty(parseInt(e.target.value) || 1)}
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Discount (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={lineDiscount}
                    onChange={(e) => setLineDiscount(parseFloat(e.target.value) || 0)}
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddLineModal(false)}
                  className="px-4 py-2 border rounded text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                  Add Product Line
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
