"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";

interface Product {
  id: number;
  sku: string;
  name: string;
  description?: string;
  category_id: number;
  category_name?: string;
  product_type: "ONE_TIME" | "RECURRING";
  base_cost?: number;
  is_active: boolean;
  created_at: string;
}

interface Category {
  id: number;
  name: string;
}

interface InventoryLocation {
  id: number;
  product_id: number;
  product_name: string;
  sku: string;
  warehouse_id: number;
  warehouse_name: string;
  warehouse_code: string;
  quantity_on_hand: number;
  reorder_threshold: number;
  updated_at: string;
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [filterType, setFilterType] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number>(0);
  const [productType, setProductType] = useState<"ONE_TIME" | "RECURRING">("ONE_TIME");
  const [baseCost, setBaseCost] = useState<number>(0);

  const [inventory, setInventory] = useState<InventoryLocation[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);

  // Restock modal
  const [restockTarget, setRestockTarget] = useState<InventoryLocation | null>(null);
  const [restockQty, setRestockQty] = useState<number>(0);
  const [restockThreshold, setRestockThreshold] = useState<number>(5);
  const [restockSaving, setRestockSaving] = useState(false);
  const [restockError, setRestockError] = useState("");

  const fetchInventory = async () => {
    setInventoryLoading(true);
    try {
      const res = await api.get<ApiResponse<InventoryLocation[]>>("/api/v1/products/inventory");
      setInventory(res.data);
    } catch (err: any) {
      console.error("Failed to load inventory locations", err);
    } finally {
      setInventoryLoading(false);
    }
  };

  const openRestock = (inv: InventoryLocation) => {
    setRestockTarget(inv);
    setRestockQty(inv.quantity_on_hand);
    setRestockThreshold(inv.reorder_threshold);
    setRestockError("");
  };

  const handleRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockTarget) return;
    setRestockSaving(true);
    setRestockError("");
    try {
      await api.post<ApiResponse<InventoryLocation>>(`/api/v1/warehouses/${restockTarget.warehouse_id}/inventory`, {
        product_id: restockTarget.product_id,
        quantity_on_hand: restockQty,
        reorder_threshold: restockThreshold,
      });
      setRestockTarget(null);
      fetchInventory();
    } catch (err: any) {
      setRestockError(err.message || "Failed to update stock");
    } finally {
      setRestockSaving(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.get<ApiResponse<Category[]>>("/api/v1/categories");
      setCategories(res.data);
      if (res.data.length > 0) setCategoryId(res.data[0].id);
    } catch {
      // ignore
    }
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: page.toString(),
        limit: "10",
      };
      if (filterType) params.product_type = filterType;
      if (filterCategory) params.category_id = filterCategory;

      const res = await api.get<ApiResponse<Product[]>>("/api/v1/products", params);
      setProducts(res.data);
      if (res.meta) {
        setTotalPages(res.meta.total_pages);
        setTotal(res.meta.total);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchInventory();
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [page, filterType, filterCategory]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/api/v1/products", {
        sku,
        name,
        description: description || undefined,
        category_id: categoryId,
        product_type: productType,
        base_cost: baseCost,
        is_active: true,
      });

      setShowModal(false);
      setSku("");
      setName("");
      setDescription("");
      setBaseCost(0);
      fetchProducts();
    } catch (err: any) {
      alert(err.message || "Failed to create product");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Catalog</h1>
          <p className="text-sm text-gray-500">Manage sellable products, variants, and product types.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 text-sm font-medium"
        >
          + Add Product
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-wrap gap-4 items-center">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Product Type</label>
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
              setPage(1);
            }}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Types</option>
            <option value="ONE_TIME">One-Time</option>
            <option value="RECURRING">Recurring (Subscription)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
          <select
            value={filterCategory}
            onChange={(e) => {
              setFilterCategory(e.target.value);
              setPage(1);
            }}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id.toString()}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>}

      {/* Products Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Base Cost</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200 text-sm">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                  Loading products...
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                  No products found.
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-mono text-xs text-gray-700">{p.sku}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">{p.name}</td>
                  <td className="px-6 py-4 text-gray-600">{p.category_name || "-"}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                        p.product_type === "RECURRING" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {p.product_type}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-800">
                    {p.base_cost !== undefined ? `$${Number(p.base_cost).toFixed(2)}` : "—"}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${
                        p.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/admin/products/${p.id}`}
                      className="text-purple-600 hover:text-purple-900 font-medium text-xs"
                    >
                      Manage & Variants →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="px-6 py-3 flex items-center justify-between border-t border-gray-200 bg-gray-50 text-sm text-gray-500">
          <div>Showing {products.length} of {total} products</div>
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

      {/* Inventory Locations Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Inventory by Location</h2>
            <p className="text-xs text-gray-500">Which warehouse holds which product, with current stock levels.</p>
          </div>
          <span className="text-xs text-gray-500">{inventory.length} stock locations</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Warehouse</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location Code</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Qty On Hand</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stock Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200 text-sm">
              {inventoryLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    Loading inventory locations...
                  </td>
                </tr>
              ) : inventory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    No inventory locations found.
                  </td>
                </tr>
              ) : (
                inventory.map((inv) => {
                  const lowStock = inv.quantity_on_hand <= inv.reorder_threshold;
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-mono text-xs text-gray-700">{inv.sku}</td>
                      <td className="px-6 py-4 font-medium text-gray-900">{inv.product_name}</td>
                      <td className="px-6 py-4 text-gray-600">{inv.warehouse_name}</td>
                      <td className="px-6 py-4 font-mono text-xs text-gray-500">{inv.warehouse_code}</td>
                      <td className="px-6 py-4 font-semibold text-gray-800">{inv.quantity_on_hand}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                            lowStock
                              ? "bg-red-100 text-red-700"
                              : inv.quantity_on_hand === 0
                              ? "bg-gray-100 text-gray-600"
                              : "bg-green-100 text-green-800"
                          }`}
                        >
                          {inv.quantity_on_hand === 0
                            ? "Out of Stock"
                            : lowStock
                            ? `Low (reorder @ ${inv.reorder_threshold})`
                            : "In Stock"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => openRestock(inv)}
                          className="px-3 py-1 text-xs font-semibold rounded border border-blue-300 text-blue-700 hover:bg-blue-50 transition"
                        >
                          Restock
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Restock Modal */}
      {restockTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-lg font-bold mb-1">Restock</h2>
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-semibold text-gray-900">{restockTarget.product_name}</span> at{" "}
              {restockTarget.warehouse_name} ({restockTarget.warehouse_code})
            </p>
            <form onSubmit={handleRestock} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Quantity On Hand</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={restockQty}
                  onChange={(e) => setRestockQty(parseInt(e.target.value) || 0)}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Reorder Threshold</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={restockThreshold}
                  onChange={(e) => setRestockThreshold(parseInt(e.target.value) || 0)}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              {restockError && <div className="text-sm text-red-600">{restockError}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRestockTarget(null)}
                  disabled={restockSaving}
                  className="px-4 py-2 border border-gray-300 rounded text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={restockSaving}
                  className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {restockSaving ? "Saving..." : "Save Stock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-lg font-bold mb-4">Create New Product</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">SKU</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SW-ENT-001"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Product Type</label>
                <select
                  value={productType}
                  onChange={(e) => setProductType(e.target.value as any)}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="ONE_TIME">One-Time Purchase</option>
                  <option value="RECURRING">Recurring (Subscription)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Base Cost ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={baseCost}
                  onChange={(e) => setBaseCost(parseFloat(e.target.value) || 0)}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
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
                <button type="submit" className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700">
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
