"use client";

import { useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface Warehouse {
  id: number;
  name: string;
  code: string;
  address: string | null;
  base_shipping_cost: number;
  is_active: boolean;
  created_at: string;
}

interface InventoryItem {
  id: number;
  product_id: number;
  product_name: string;
  sku: string;
  quantity_on_hand: number;
  reorder_threshold: number;
}

interface ProductOption {
  id: number;
  name: string;
  sku: string;
  track_inventory: boolean;
}

export default function AdminWarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [form, setForm] = useState({ name: "", code: "", address: "", base_shipping_cost: "" });
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [stockForm, setStockForm] = useState({ product_id: "", quantity_on_hand: "", reorder_threshold: "" });
  const [stockSaving, setStockSaving] = useState(false);

  const fetchWarehouses = async () => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<Warehouse[]>>("/api/v1/warehouses", { page: page.toString(), limit: "10" });
      setWarehouses(res.data);
      if (res.meta) {
        setTotal(res.meta.total);
        setTotalPages(res.meta.total_pages);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load warehouses");
    } finally {
      setLoading(false);
    }
  };

  const fetchInventory = async (id: number) => {
    setSelectedId(id);
    try {
      const res = await api.get<ApiResponse<InventoryItem[]>>(`/api/v1/warehouses/${id}/inventory`, { limit: "100" });
      setInventory(res.data);
    } catch {
      setInventory([]);
    }
  };

  useEffect(() => {
    fetchWarehouses();
  }, [page]);

  useEffect(() => {
    if (selectedId === null) return;
    api.get<ApiResponse<ProductOption[]>>("/api/v1/products", { limit: "100", is_active: "true" }).then((res) => {
      setProducts(res.data);
    }).catch(() => setProducts([]));
  }, [selectedId]);

  const createWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      await api.post("/api/v1/warehouses", {
        name: form.name,
        code: form.code,
        address: form.address || undefined,
        base_shipping_cost: form.base_shipping_cost ? Number(form.base_shipping_cost) : undefined,
      });
      setForm({ name: "", code: "", address: "", base_shipping_cost: "" });
      setPage(1);
      await fetchWarehouses();
    } catch (err: any) {
      setError(err.message || "Failed to create warehouse");
    } finally {
      setCreating(false);
    }
  };

  const saveStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedId === null) return;
    setStockSaving(true);
    try {
      await api.post(`/api/v1/warehouses/${selectedId}/inventory`, {
        product_id: Number(stockForm.product_id),
        quantity_on_hand: Number(stockForm.quantity_on_hand),
        reorder_threshold: stockForm.reorder_threshold ? Number(stockForm.reorder_threshold) : undefined,
      });
      setStockForm({ product_id: "", quantity_on_hand: "", reorder_threshold: "" });
      await fetchInventory(selectedId);
    } catch (err: any) {
      alert(err.message || "Failed to update stock");
    } finally {
      setStockSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Warehouses</h1>
        <p className="text-sm text-gray-500">
          Fulfillment locations and on-hand inventory for the allocation engine.
        </p>
      </div>

      {error && <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Warehouse list */}
        <div className="xl:col-span-3 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-6 py-3 text-left">Code</th>
                <th className="px-6 py-3 text-left">Name</th>
                <th className="px-6 py-3 text-right">Shipping</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-right">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-6 text-center text-gray-500">Loading warehouses...</td>
                </tr>
              ) : warehouses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-6 text-center text-gray-500">No warehouses configured.</td>
                </tr>
              ) : (
                warehouses.map((w) => (
                  <tr key={w.id} className={`hover:bg-gray-50 ${selectedId === w.id ? "bg-blue-50" : ""}`}>
                    <td className="px-6 py-4 font-mono font-bold text-purple-700">{w.code}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">{w.name}</td>
                    <td className="px-6 py-4 text-right text-gray-900">${Number(w.base_shipping_cost).toFixed(2)}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded ${w.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                        {w.is_active ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => fetchInventory(w.id)}
                        className="text-purple-600 hover:text-purple-900 font-medium text-xs"
                      >
                        {selectedId === w.id ? "Viewing..." : "Manage Stock →"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="px-6 py-3 flex items-center justify-between border-t border-gray-200 bg-gray-50 text-sm text-gray-500">
            <div>{warehouses.length} of {total} warehouses</div>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 border rounded bg-white disabled:opacity-50">Previous</button>
              <span className="py-1">Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1 border rounded bg-white disabled:opacity-50">Next</button>
            </div>
          </div>

          {/* Create form */}
          <div className="border-t border-gray-200 p-6">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Add Warehouse</h3>
            <form onSubmit={createWarehouse} className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Name"
                required
                className="border rounded px-3 py-2 text-sm"
              />
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="Code (e.g. MUM-01)"
                required
                className="border rounded px-3 py-2 text-sm"
              />
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Address"
                className="border rounded px-3 py-2 text-sm"
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.base_shipping_cost}
                onChange={(e) => setForm({ ...form, base_shipping_cost: e.target.value })}
                placeholder="Shipping cost"
                className="border rounded px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={creating}
                className="bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </form>
          </div>
        </div>

        {/* Inventory panel */}
        <div className="xl:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-bold text-gray-900">
            {selectedId === null ? "Inventory" : `Stock at ${warehouses.find((w) => w.id === selectedId)?.name ?? "warehouse"}`}
          </h2>

          {selectedId === null ? (
            <p className="text-sm text-gray-500">Select a warehouse to view and adjust its on-hand stock.</p>
          ) : (
            <>
              <ul className="divide-y divide-gray-100 text-sm max-h-72 overflow-y-auto">
                {inventory.length === 0 ? (
                  <li className="py-3 text-gray-500">No inventory recorded yet.</li>
                ) : (
                  inventory.map((item) => (
                    <li key={item.id} className="py-3 flex items-center justify-between">
                      <div>
                        <span className="font-medium text-gray-900 block">{item.product_name}</span>
                        <span className="text-xs text-gray-400">{item.sku}</span>
                      </div>
                      <div className="text-right">
                        <span className={`font-bold ${item.quantity_on_hand <= item.reorder_threshold ? "text-red-600" : "text-gray-900"}`}>
                          {item.quantity_on_hand}
                        </span>
                        <span className="text-xs text-gray-400 block">reorder @ {item.reorder_threshold}</span>
                      </div>
                    </li>
                  ))
                )}
              </ul>

              <form onSubmit={saveStock} className="grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-gray-100 pt-4">
                <select
                  value={stockForm.product_id}
                  onChange={(e) => setStockForm({ ...stockForm, product_id: e.target.value })}
                  required
                  className="col-span-2 border rounded px-3 py-2 text-sm"
                >
                  <option value="">Select product...</option>
                  {products
                    .filter((p) => p.track_inventory)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                </select>
                <input
                  type="number"
                  min={0}
                  value={stockForm.quantity_on_hand}
                  onChange={(e) => setStockForm({ ...stockForm, quantity_on_hand: e.target.value })}
                  placeholder="On hand"
                  required
                  className="border rounded px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={0}
                  value={stockForm.reorder_threshold}
                  onChange={(e) => setStockForm({ ...stockForm, reorder_threshold: e.target.value })}
                  placeholder="Reorder"
                  className="border rounded px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={stockSaving}
                  className="col-span-2 md:col-span-4 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {stockSaving ? "Saving..." : "Set Stock Level"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}