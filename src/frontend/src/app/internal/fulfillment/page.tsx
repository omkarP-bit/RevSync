"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";
import { useCurrency } from "@/components/CurrencyProvider";

interface FulfillmentOrder {
  id: number;
  quotation_id: number;
  status: string;
  shipping_cost: number;
  backordered_quantity: number;
  created_at: string;
  quotation_number: string;
  customer_name: string;
}

const statusTabs = [
  { label: "All", value: "" },
  { label: "Allocated", value: "ALLOCATED" },
  { label: "Partial", value: "PARTIAL" },
  { label: "Backordered", value: "BACKORDERED" },
  { label: "Shipped", value: "SHIPPED" },
  { label: "Cancelled", value: "CANCELLED" },
];

const statusStyles: Record<string, string> = {
  ALLOCATED: "bg-blue-100 text-blue-800",
  PARTIAL: "bg-yellow-100 text-yellow-800",
  BACKORDERED: "bg-red-100 text-red-800",
  SHIPPED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-600",
};

export default function FulfillmentListPage() {
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedStatus, setSelectedStatus] = useState("");
  const [userRoleId, setUserRoleId] = useState<number | null>(null);
  const [quoteId, setQuoteId] = useState("");
  const [creating, setCreating] = useState(false);
  const { format } = useCurrency();

  const isFulfillmentManager = userRoleId === 4 || userRoleId === 5;

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: page.toString(), limit: "10" };
      if (selectedStatus) params.status = selectedStatus;

      const res = await api.get<ApiResponse<FulfillmentOrder[]>>("/api/v1/fulfillment", params);
      setOrders(res.data);
      if (res.meta) {
        setTotalPages(res.meta.total_pages);
        setTotal(res.meta.total);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load fulfillment orders");
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
    fetchOrders();
  }, [page, selectedStatus]);

  const createFulfillment = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      await api.post("/api/v1/fulfillment", { quotation_id: Number(quoteId) });
      setQuoteId("");
      setPage(1);
      await fetchOrders();
    } catch (err: any) {
      setError(err.message || "Failed to create fulfillment order");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Fulfillment</h1>
        <p className="text-sm text-gray-500">
          Multi-warehouse allocation and shipping for confirmed quotations.
        </p>
      </div>

      {isFulfillmentManager && (
        <form onSubmit={createFulfillment} className="flex items-end gap-3 bg-white p-4 rounded-lg shadow-sm border border-gray-200 max-w-2xl">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Quotation ID to fulfill</label>
            <input
              type="number"
              min={1}
              value={quoteId}
              onChange={(e) => setQuoteId(e.target.value)}
              placeholder="e.g. 3 (must be CONFIRMED)"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !quoteId}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Allocating..." : "Create Fulfillment"}
          </button>
        </form>
      )}

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
              <th className="px-6 py-3 text-left">Order</th>
              <th className="px-6 py-3 text-left">Quote</th>
              <th className="px-6 py-3 text-left">Customer</th>
              <th className="px-6 py-3 text-right">Backorder Qty</th>
              <th className="px-6 py-3 text-right">Shipping</th>
              <th className="px-6 py-3 text-left">Created</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200 text-sm">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-6 py-6 text-center text-gray-500">
                  Loading fulfillment orders...
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-6 text-center text-gray-500">
                  No fulfillment orders found for this filter.
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-mono font-bold text-blue-700">FO-{String(o.id).padStart(4, "0")}</td>
                  <td className="px-6 py-4">
                    <Link href={`/internal/quotations/${o.quotation_id}`} className="font-mono text-blue-600 hover:underline">
                      {o.quotation_number}
                    </Link>
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900">{o.customer_name}</td>
                  <td className="px-6 py-4 text-right font-semibold text-red-600">{o.backordered_quantity}</td>
                  <td className="px-6 py-4 text-right font-bold text-gray-900">
                    {format(o.shipping_cost)}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{new Date(o.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded ${statusStyles[o.status] || "bg-gray-100 text-gray-700"}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link href={`/internal/fulfillment/${o.id}`} className="text-blue-600 hover:text-blue-900 font-medium text-xs">
                      Detail →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="px-6 py-3 flex items-center justify-between border-t border-gray-200 bg-gray-50 text-sm text-gray-500">
          <div>Showing {orders.length} of {total} orders</div>
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
    </div>
  );
}