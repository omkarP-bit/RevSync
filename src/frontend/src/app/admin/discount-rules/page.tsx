"use client";

import { useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface DiscountRule {
  id: number;
  customer_tier_id: number;
  tier_name: string;
  category_id: number;
  category_name: string;
  max_discount_pct: number;
  is_active: boolean;
}

interface Category {
  id: number;
  name: string;
}

interface Customer {
  id: number;
  tier_id: number;
  tier_name: string;
}

export default function DiscountRulesPage() {
  const [rules, setRules] = useState<DiscountRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tiers, setTiers] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add rule form
  const [tierId, setTierId] = useState(0);
  const [categoryId, setCategoryId] = useState(0);
  const [maxDiscount, setMaxDiscount] = useState(10);

  const fetchRules = async () => {
    try {
      const res = await api.get<ApiResponse<DiscountRule[]>>("/api/v1/discounts/rules", { limit: "100" });
      setRules(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load discount rules");
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await fetchRules();
        const [catRes, custRes] = await Promise.all([
          api.get<ApiResponse<Category[]>>("/api/v1/categories", { limit: "100" }),
          api.get<ApiResponse<Customer[]>>("/api/v1/customers", { limit: "100" }),
        ]);
        setCategories(catRes.data);
        const tierMap = new Map<number, string>();
        for (const c of custRes.data) {
          if (!tierMap.has(Number(c.tier_id))) tierMap.set(Number(c.tier_id), c.tier_name);
        }
        setTiers([...tierMap.entries()].map(([id, name]) => ({ id, name })));
        if (catRes.data.length > 0) setCategoryId(catRes.data[0].id);
      } catch (err: any) {
        setError(err.message || "Failed to load configuration");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tierId || !categoryId) {
      alert("Select a tier and category");
      return;
    }
    try {
      await api.post("/api/v1/discounts/rules", {
        customer_tier_id: tierId,
        category_id: categoryId,
        max_discount_pct: maxDiscount,
      });
      setError("");
      await fetchRules();
    } catch (err: any) {
      alert(err.message || "Failed to create rule");
    }
  };

  const handleUpdate = async (rule: DiscountRule, patch: Record<string, unknown>) => {
    try {
      await api.patch(`/api/v1/discounts/rules/${rule.id}`, patch);
      await fetchRules();
    } catch (err: any) {
      alert(err.message || "Failed to update rule");
    }
  };

  if (loading) return <div className="p-6 text-gray-500">Loading discount rules...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Discount Rules</h1>
        <p className="text-sm text-gray-500">
          Max discount allowed per customer tier x product category. Exceeding it flags the line as a discount overage.
        </p>
      </div>

      {error && <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>}

      {/* Add rule */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Add Discount Rule</h2>
        <form onSubmit={handleAdd} className="grid md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Customer Tier</label>
            <select
              value={tierId}
              onChange={(e) => setTierId(Number(e.target.value))}
              required
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value={0}>Select tier</option>
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
              required
              className="w-full border rounded px-3 py-2 text-sm"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Max Discount (%)</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              required
              value={maxDiscount}
              onChange={(e) => setMaxDiscount(parseFloat(e.target.value) || 0)}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
            Add Rule
          </button>
        </form>
      </div>

      {/* Rule table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-6 py-3 text-left">Tier</th>
              <th className="px-6 py-3 text-left">Category</th>
              <th className="px-6 py-3 text-right">Max Discount (%)</th>
              <th className="px-6 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rules.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-400">
                  No discount rules configured yet.
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{rule.tier_name || `Tier ${rule.customer_tier_id}`}</td>
                  <td className="px-6 py-4 text-gray-600">{rule.category_name || `Category ${rule.category_id}`}</td>
                  <td className="px-6 py-4 text-right">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={Number(rule.max_discount_pct)}
                      onChange={(e) => handleUpdate(rule, { max_discount_pct: parseFloat(e.target.value) || 0 })}
                      className="w-20 border rounded px-2 py-1 text-right font-bold text-gray-800"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleUpdate(rule, { is_active: !rule.is_active })}
                      className={`px-2 py-1 text-xs font-semibold rounded ${
                        rule.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {rule.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}