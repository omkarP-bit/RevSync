"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";
import { exportFulfillmentPdf } from "@/lib/pdf";

interface Allocation {
  id: number;
  quotation_line_id: number;
  product_id: number;
  product_name: string;
  warehouse_id: number;
  warehouse_name: string;
  warehouse_code: string;
  quantity: number;
  unit_shipping_cost: number;
}

interface FulfillmentDetail {
  id: number;
  quotation_id: number;
  status: string;
  shipping_cost: number;
  backordered_quantity: number;
  shipped_at: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
  quotation_number: string;
  customer_id: number;
  customer_name: string;
  grand_total: number;
  allocations: Allocation[];
}

interface WarehouseOption {
  id: number;
  name: string;
  code: string;
}

const statusStyles: Record<string, string> = {
  ALLOCATED: "bg-blue-100 text-blue-800",
  PARTIAL: "bg-yellow-100 text-yellow-800",
  BACKORDERED: "bg-red-100 text-red-800",
  SHIPPED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-600",
};

export default function FulfillmentDetailPage() {
  const params = useParams();
  const orderId = params?.id as string;

  const [order, setOrder] = useState<FulfillmentDetail | null>(null);
  const [userRoleId, setUserRoleId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [newWarehouse, setNewWarehouse] = useState("");
  const [newProduct, setNewProduct] = useState("");
  const [newQty, setNewQty] = useState("");

  const isFulfillmentManager = userRoleId === 4 || userRoleId === 5;

  const fetchOrder = async () => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<FulfillmentDetail>>(`/api/v1/fulfillment/${orderId}`);
      setOrder(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load fulfillment order");
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
    if (orderId) fetchOrder();
  }, [orderId]);

  const loadWarehouses = async () => {
    try {
      const res = await api.get<ApiResponse<WarehouseOption[]>>("/api/v1/warehouses", { limit: "100" });
      setWarehouses(res.data);
      setNewWarehouse(String(res.data[0]?.id ?? ""));
    } catch {
      setWarehouses([]);
    }
  };

  const action = async (fn: () => Promise<void>, actionName: string) => {
    setActing(true);
    try {
      await fn();
      await fetchOrder();
    } catch (err: any) {
      alert(err.message || `Failed to ${actionName}`);
    } finally {
      setActing(false);
    }
  };

  const startOverride = () => {
    setEdits(
      Object.fromEntries(order?.allocations.map((a) => [a.id, String(a.quantity)]) ?? [])
    );
    setEditing(true);
    loadWarehouses();
  };

  const submitOverride = async () => {
    if (!order) return;
    const allocations: { product_id: number; warehouse_id: number; quantity: number }[] = [];

    for (const alloc of order.allocations) {
      const qty = Number(edits[alloc.id]);
      if (qty >= 0) allocations.push({ product_id: alloc.product_id, warehouse_id: alloc.warehouse_id, quantity: qty });
    }
    if (newProduct && newWarehouse && Number(newQty) > 0) {
      allocations.push({ product_id: Number(newProduct), warehouse_id: Number(newWarehouse), quantity: Number(newQty) });
    }

    if (allocations.length === 0) {
      alert("No allocation changes to submit");
      return;
    }

    await action(
      () => api.post(`/api/v1/fulfillment/${orderId}/override`, { allocations }),
      "apply override"
    );
    setEditing(false);
  };

  if (loading) return <div className="p-6 text-gray-500">Loading fulfillment detail...</div>;
  if (error || !order) return <div className="p-6 text-red-600">{error || "Fulfillment order not found"}</div>;

  const cannotMutate = order.status === "SHIPPED" || order.status === "CANCELLED";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/internal/fulfillment" className="text-gray-500 hover:text-gray-700 text-sm">
            ← Back to Fulfillment
          </Link>
          <span className="text-gray-300">|</span>
          <span className="font-mono text-xs font-bold text-blue-700">
            FO-{String(order.id).padStart(4, "0")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportFulfillmentPdf(order)}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 text-sm font-medium"
          >
            ⬇ Export PDF
          </button>
          <span className={`px-2 py-1 text-xs font-semibold rounded ${statusStyles[order.status] || "bg-gray-100 text-gray-700"}`}>
            {order.status}
          </span>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{order.customer_name}</h1>
            <p className="text-xs text-gray-500 mt-1">
              Created {new Date(order.created_at).toLocaleString()}
              {order.shipped_at ? ` · Shipped ${new Date(order.shipped_at).toLocaleString()}` : ""}
            </p>
          </div>
          <Link
            href={`/internal/quotations/${order.quotation_id}`}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
          >
            Open Quotation →
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100 text-xs">
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Quotation</span>
            <span className="font-mono font-bold text-gray-900">{order.quotation_number}</span>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Grand Total</span>
            <span className="text-sm font-bold text-gray-900">${Number(order.grand_total).toFixed(2)}</span>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Shipping Cost</span>
            <span className="text-sm font-bold text-gray-900">${Number(order.shipping_cost).toFixed(2)}</span>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Backordered</span>
            <span className="text-sm font-bold text-red-600">{order.backordered_quantity} units</span>
          </div>
        </div>

        {order.notes && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800">
            <span className="font-semibold">Notes:</span> {order.notes}
          </div>
        )}
      </div>

      {/* Allocations */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Warehouse Allocations</h2>
          {isFulfillmentManager && !cannotMutate && (
            <button
              onClick={() => (editing ? submitOverride() : startOverride())}
              disabled={acting}
              className="px-3 py-1.5 border border-blue-300 text-blue-700 bg-white rounded-md text-sm font-medium hover:bg-blue-50 disabled:opacity-50"
            >
              {editing ? (acting ? "Saving..." : "Save Override") : "Override Allocation"}
            </button>
          )}
        </div>

        {order.allocations.length === 0 ? (
          <p className="text-sm text-gray-500">No allocations on this order.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Warehouse</th>
                <th className="px-4 py-2 text-left">Product</th>
                <th className="px-4 py-2 text-right">Quantity</th>
                <th className="px-4 py-2 text-right">Unit Shipping</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {order.allocations.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {a.warehouse_name} <span className="text-xs text-gray-400">({a.warehouse_code})</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{a.product_name}</td>
                  <td className="px-4 py-3 text-right">
                    {editing && !cannotMutate ? (
                      <input
                        type="number"
                        min={0}
                        value={edits[a.id] ?? a.quantity}
                        onChange={(e) => setEdits({ ...edits, [a.id]: e.target.value })}
                        className="w-20 border rounded px-2 py-1 text-right"
                      />
                    ) : (
                      <span className="font-semibold">{a.quantity}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    ${Number(a.unit_shipping_cost).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {editing && isFulfillmentManager && !cannotMutate && (
          <div className="flex items-end gap-3 border-t border-gray-100 pt-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Add warehouse allocation</label>
              <select
                value={newWarehouse}
                onChange={(e) => setNewWarehouse(e.target.value)}
                className="border rounded px-2 py-2 text-sm"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Product ID</label>
              <input
                type="number"
                min={1}
                value={newProduct}
                onChange={(e) => setNewProduct(e.target.value)}
                placeholder="product id"
                className="border rounded px-2 py-2 text-sm w-28"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                placeholder="qty"
                className="border rounded px-2 py-2 text-sm w-24"
              />
            </div>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-2 text-sm text-gray-600 border rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      {isFulfillmentManager && !cannotMutate && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex justify-end gap-2">
          <button
            disabled={acting}
            onClick={() => action(() => api.post(`/api/v1/fulfillment/${orderId}/cancel`), "cancel order")}
            className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {acting ? "Working..." : "Cancel Order"}
          </button>
          <button
            disabled={acting || order.status === "BACKORDERED"}
            onClick={() => action(() => api.post(`/api/v1/fulfillment/${orderId}/ship`), "ship order")}
            className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            title={order.status === "BACKORDERED" ? "Nothing allocated to ship" : "Deduct inventory and mark shipped"}
          >
            {acting ? "Working..." : "Ship Order"}
          </button>
        </div>
      )}
    </div>
  );
}