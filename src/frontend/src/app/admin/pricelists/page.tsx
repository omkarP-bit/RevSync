"use client";

import { useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface PriceList {
  id: number;
  name: string;
  customer_tier_id: number;
  tier_name: string;
  currency_code: string;
  is_active: boolean;
}

interface PriceListItem {
  id: number;
  price_list_id: number;
  product_id: number;
  product_name: string;
  product_sku: string;
  unit_price: number;
}

interface PriceListDetail extends PriceList {
  items: PriceListItem[];
}

interface Tier {
  id: number;
  name: string;
}

interface Currency {
  code: string;
  name: string;
}

interface Product {
  id: number;
  name: string;
  sku: string;
}

const DEFAULT_CURRENCIES: Currency[] = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "INR", name: "Indian Rupee" },
];

export default function AdminPriceListsPage() {
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [selectedList, setSelectedList] = useState<PriceListDetail | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [filterTier, setFilterTier] = useState("");
  const [filterCurrency, setFilterCurrency] = useState("");

  // Create List Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [plName, setPlName] = useState("");
  const [plTierId, setPlTierId] = useState<number>(0);
  const [plCurrency, setPlCurrency] = useState("");

  // Item Editor Modal
  const [showItemModal, setShowItemModal] = useState(false);
  const [itemProductId, setItemProductId] = useState<number>(0);
  const [itemUnitPrice, setItemUnitPrice] = useState<number>(0);

  const fetchReferenceData = async () => {
    try {
      const curRes = await api.get<ApiResponse<Currency[]>>("/api/v1/currencies");
      if (curRes.data && curRes.data.length > 0) {
        setCurrencies(curRes.data);
        if (!plCurrency) setPlCurrency(curRes.data[0].code);
      } else {
        setCurrencies(DEFAULT_CURRENCIES);
        if (!plCurrency) setPlCurrency(DEFAULT_CURRENCIES[0].code);
      }
    } catch {
      setCurrencies(DEFAULT_CURRENCIES);
      if (!plCurrency) setPlCurrency(DEFAULT_CURRENCIES[0].code);
    }

    try {
      const prodRes = await api.get<ApiResponse<Product[]>>("/api/v1/products", { limit: "100" });
      if (prodRes.data) {
        setProducts(prodRes.data);
        if (prodRes.data.length > 0) setItemProductId(prodRes.data[0].id);
      }
    } catch {
      // ignore product error
    }

    try {
      const custRes = await api.get<ApiResponse<{ tier_id: number; tier_name: string }[]>>("/api/v1/customers", { limit: "100" });
      if (custRes.data) {
        const tierMap = new Map<number, string>();
        for (const c of custRes.data) {
          if (c.tier_id && !tierMap.has(Number(c.tier_id))) {
            tierMap.set(Number(c.tier_id), c.tier_name || `Tier ${c.tier_id}`);
          }
        }
        if (tierMap.size > 0) {
          const loadedTiers = [...tierMap.entries()].map(([id, name]) => ({ id, name }));
          setTiers(loadedTiers);
          setPlTierId(loadedTiers[0].id);
        } else {
          setTiers([
            { id: 1, name: "Bronze" },
            { id: 2, name: "Silver" },
            { id: 3, name: "Gold" },
          ]);
          setPlTierId(1);
        }
      }
    } catch {
      setTiers([
        { id: 1, name: "Bronze" },
        { id: 2, name: "Silver" },
        { id: 3, name: "Gold" },
      ]);
      setPlTierId(1);
    }
  };

  useEffect(() => {
    if (products.length > 0 && (!itemProductId || !products.some((p) => p.id === itemProductId))) {
      setItemProductId(products[0].id);
    }
  }, [products, itemProductId]);

  useEffect(() => {
    const list = currencies.length > 0 ? currencies : DEFAULT_CURRENCIES;
    if (!plCurrency || !list.some((c) => c.code === plCurrency)) {
      setPlCurrency(list[0].code);
    }
  }, [currencies, plCurrency]);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchPriceLists = async (p = page) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: p.toString(), limit: "10" };
      if (filterTier) params.tier_id = filterTier;
      if (filterCurrency) params.currency_code = filterCurrency;

      const res = await api.get<ApiResponse<PriceList[]>>("/api/v1/pricelists", params);
      setPriceLists(res.data);
      if (res.meta) {
        setTotalPages(res.meta.total_pages);
        setTotal(res.meta.total);
      }
      if (res.data.length > 0 && !selectedList) {
        fetchPriceListDetail(res.data[0].id);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load price lists");
    } finally {
      setLoading(false);
    }
  };

  const fetchPriceListDetail = async (id: number) => {
    try {
      const res = await api.get<ApiResponse<PriceListDetail>>(`/api/v1/pricelists/${id}`);
      setSelectedList(res.data);
    } catch (err: any) {
      alert(err.message || "Failed to load price list details");
    }
  };

  useEffect(() => {
    fetchReferenceData();
  }, []);

  useEffect(() => {
    fetchPriceLists(page);
  }, [page, filterTier, filterCurrency]);

  const handleCreatePriceList = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<ApiResponse<PriceList>>("/api/v1/pricelists", {
        name: plName,
        customer_tier_id: plTierId,
        currency_code: plCurrency,
        is_active: true,
      });

      setShowCreateModal(false);
      setPlName("");
      fetchPriceLists();
      fetchPriceListDetail(res.data.id);
    } catch (err: any) {
      alert(err.message || "Failed to create price list");
    }
  };

  const handleSetItemPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedList) return;

    try {
      await api.post(`/api/v1/pricelists/${selectedList.id}/items`, {
        product_id: itemProductId,
        unit_price: itemUnitPrice,
      });

      setShowItemModal(false);
      setItemUnitPrice(0);
      fetchPriceListDetail(selectedList.id);
    } catch (err: any) {
      alert(err.message || "Failed to set item price");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Price Lists & Matrix</h1>
          <p className="text-sm text-gray-500">Tier × Currency scoped price resolution matrix.</p>
        </div>
        <button
          onClick={() => {
            const list = currencies.length > 0 ? currencies : DEFAULT_CURRENCIES;
            if (!plCurrency || !list.some((c) => c.code === plCurrency)) {
              setPlCurrency(list[0].code);
            }
            if (currencies.length === 0) fetchReferenceData();
            setShowCreateModal(true);
          }}
          className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 text-sm font-medium"
        >
          + Add Price List
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-wrap gap-4 items-center">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Customer Tier</label>
          <select
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Tiers</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id.toString()}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
          <select
            value={filterCurrency}
            onChange={(e) => setFilterCurrency(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Currencies</option>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} - {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Side: Price Lists Selection */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-3">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Price Lists ({priceLists.length})</h2>
          {loading ? (
            <p className="text-xs text-gray-500">Loading lists...</p>
          ) : priceLists.length === 0 ? (
            <p className="text-xs text-gray-500">No price lists defined.</p>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {priceLists.map((pl) => (
                <div
                  key={pl.id}
                  onClick={() => fetchPriceListDetail(pl.id)}
                  className={`p-3 rounded-lg border text-xs cursor-pointer transition ${
                    selectedList?.id === pl.id
                      ? "border-purple-500 bg-purple-50 ring-1 ring-purple-500"
                      : "border-gray-200 hover:border-purple-300 bg-white"
                  }`}
                >
                  <div className="font-bold text-gray-900">{pl.name}</div>
                  <div className="flex justify-between items-center mt-2 text-gray-500">
                    <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-700 font-medium">Tier: {pl.tier_name}</span>
                    <span className="font-bold text-purple-700">{pl.currency_code}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination Controls */}
          <div className="flex justify-between items-center text-xs text-gray-500 pt-3 border-t">
            <span>Page {page} of {totalPages} ({total})</span>
            <div className="flex gap-1.5">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 border border-gray-300 rounded bg-white font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
              >
                Prev
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 border border-gray-300 rounded bg-white font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Selected Price List Items Matrix */}
        <div className="md:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          {!selectedList ? (
            <div className="text-gray-400 text-center py-12">Select a price list to manage product unit prices</div>
          ) : (
            <>
              <div className="flex justify-between items-start border-b pb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedList.name}</h2>
                  <div className="flex gap-2 text-xs text-gray-500 mt-1">
                    <span>Tier: <strong>{selectedList.tier_name}</strong></span>
                    <span>•</span>
                    <span>Currency: <strong>{selectedList.currency_code}</strong></span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (products.length === 0) {
                      fetchReferenceData();
                    } else if (!itemProductId || !products.some((p) => p.id === itemProductId)) {
                      setItemProductId(products[0].id);
                    }
                    setShowItemModal(true);
                  }}
                  className="bg-purple-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-purple-700"
                >
                  + Add / Update Product Price
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Product SKU</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Product Name</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Unit Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {selectedList.items.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                          No product prices set for this list yet. Click &quot;+ Add / Update Product Price&quot; to add one.
                        </td>
                      </tr>
                    ) : (
                      selectedList.items.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-gray-700">{item.product_sku}</td>
                          <td className="px-4 py-3 font-medium text-gray-900">{item.product_name}</td>
                          <td className="px-4 py-3 text-right font-bold text-green-700">
                            {selectedList.currency_code} {Number(item.unit_price).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Create Price List Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-lg font-bold mb-4">Create New Price List</h2>
            <form onSubmit={handleCreatePriceList} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Price List Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Gold Tier - USD Matrix"
                  value={plName}
                  onChange={(e) => setPlName(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Customer Tier</label>
                <select
                  value={plTierId}
                  onChange={(e) => setPlTierId(Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Currency</label>
                <select
                  value={plCurrency}
                  onChange={(e) => setPlCurrency(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {(currencies.length > 0 ? currencies : DEFAULT_CURRENCIES).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} - {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border rounded text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700">
                  Save Price List
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Set Item Price Modal */}
      {showItemModal && selectedList && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-lg font-bold mb-4">Set Price for {selectedList.name}</h2>
            <form onSubmit={handleSetItemPrice} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Select Product</label>
                <select
                  value={itemProductId}
                  onChange={(e) => setItemProductId(Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {products.length === 0 ? (
                    <option value={0}>No products available</option>
                  ) : (
                    products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Unit Price ({selectedList.currency_code})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={itemUnitPrice}
                  onChange={(e) => setItemUnitPrice(parseFloat(e.target.value) || 0)}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowItemModal(false)}
                  className="px-4 py-2 border rounded text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700">
                  Save Unit Price
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
