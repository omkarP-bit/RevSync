"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";

interface Variant {
  id: number;
  sku: string;
  name: string;
  attributes: Record<string, any>;
}

interface PriceListEntry {
  id: number;
  price_list_id: number;
  price_list_name: string;
  customer_tier_id: number;
  tier_name: string;
  currency_code: string;
  unit_price: number;
}

interface ProductDetail {
  id: number;
  sku: string;
  name: string;
  description?: string;
  category_id: number;
  category_name?: string;
  product_type: "ONE_TIME" | "RECURRING";
  base_cost?: number;
  is_active: boolean;
  variants: Variant[];
  pricing: PriceListEntry[];
}

interface Relationship {
  id: number;
  product_id: number;
  related_product_id: number;
  related_product_name: string;
  related_product_sku: string;
  relationship_type: "UPSELL" | "CROSS_SELL";
}

interface SimpleProduct {
  id: number;
  name: string;
  sku: string;
}

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params?.id as string;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [allProducts, setAllProducts] = useState<SimpleProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Variant Modal
  const [showVariantModal, setShowVariantModal] = useState(false);
  const [varSku, setVarSku] = useState("");
  const [varName, setVarName] = useState("");
  const [varAttrKey, setVarAttrKey] = useState("pack");
  const [varAttrVal, setVarAttrVal] = useState("Standard");

  // Relationship Form
  const [showRelModal, setShowRelModal] = useState(false);
  const [relProductId, setRelProductId] = useState<number>(0);
  const [relType, setRelType] = useState<"UPSELL" | "CROSS_SELL">("CROSS_SELL");

  const fetchProductDetail = async () => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<ProductDetail>>(`/api/v1/products/${productId}`);
      setProduct(res.data);

      const relRes = await api.get<ApiResponse<Relationship[]>>(`/api/v1/products/${productId}/relationships`);
      setRelationships(relRes.data);
    } catch (err: any) {
      setError(err.message || "Failed to load product");
    } finally {
      setLoading(false);
    }
  };

  const fetchAllProducts = async () => {
    try {
      const res = await api.get<ApiResponse<SimpleProduct[]>>("/api/v1/products", { limit: "100" });
      setAllProducts(res.data.filter((p) => p.id !== Number(productId)));
      if (res.data.length > 0) setRelProductId(res.data[0].id);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (productId) {
      fetchProductDetail();
      fetchAllProducts();
    }
  }, [productId]);

  const handleAddVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/api/v1/products/${productId}/variants`, {
        sku: varSku,
        name: varName,
        attributes: { [varAttrKey]: varAttrVal },
      });

      setShowVariantModal(false);
      setVarSku("");
      setVarName("");
      fetchProductDetail();
    } catch (err: any) {
      alert(err.message || "Failed to add variant");
    }
  };

  const handleAddRelationship = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/api/v1/products/${productId}/relationships`, {
        related_product_id: relProductId,
        relationship_type: relType,
      });

      setShowRelModal(false);
      fetchProductDetail();
    } catch (err: any) {
      alert(err.message || "Failed to add relationship");
    }
  };

  if (loading) return <div className="p-6 text-gray-500">Loading product details...</div>;
  if (error || !product) return <div className="p-6 text-red-600">{error || "Product not found"}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/products" className="text-gray-500 hover:text-gray-700 text-sm">
          ← Back to Products
        </Link>
      </div>

      {/* Header */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex justify-between items-start">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
            <span
              className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                product.product_type === "RECURRING" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"
              }`}
            >
              {product.product_type}
            </span>
          </div>
          <p className="text-xs font-mono text-gray-500 mt-1">SKU: {product.sku}</p>
          <p className="text-sm text-gray-600 mt-2">{product.description || "No description provided."}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Base Cost</div>
          <div className="text-xl font-bold text-gray-900">
            {product.base_cost !== undefined ? `$${Number(product.base_cost).toFixed(2)}` : "Protected"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Variants Section */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-900">Product Variants ({product.variants.length})</h2>
            <button
              onClick={() => setShowVariantModal(true)}
              className="bg-purple-50 text-purple-700 border border-purple-200 px-3 py-1 rounded text-xs font-medium hover:bg-purple-100"
            >
              + Add Variant
            </button>
          </div>

          {product.variants.length === 0 ? (
            <p className="text-xs text-gray-500">No variants defined yet.</p>
          ) : (
            <div className="space-y-2">
              {product.variants.map((v) => (
                <div key={v.id} className="p-3 border rounded-md bg-gray-50 flex justify-between items-center text-xs">
                  <div>
                    <div className="font-semibold text-gray-800">{v.name}</div>
                    <div className="font-mono text-gray-500">{v.sku}</div>
                  </div>
                  <div className="text-gray-600 bg-white px-2 py-1 border rounded">
                    {JSON.stringify(v.attributes)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Product Relationships Section */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-900">Upsell & Cross-Sell ({relationships.length})</h2>
            <button
              onClick={() => setShowRelModal(true)}
              className="bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded text-xs font-medium hover:bg-blue-100"
            >
              + Link Product
            </button>
          </div>

          {relationships.length === 0 ? (
            <p className="text-xs text-gray-500">No linked recommendations configured.</p>
          ) : (
            <div className="space-y-2">
              {relationships.map((r) => (
                <div key={r.id} className="p-3 border rounded-md bg-gray-50 flex justify-between items-center text-xs">
                  <div>
                    <div className="font-semibold text-gray-800">{r.related_product_name}</div>
                    <div className="font-mono text-gray-500">{r.related_product_sku}</div>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-xs font-bold rounded ${
                      r.relationship_type === "UPSELL" ? "bg-green-100 text-green-800" : "bg-indigo-100 text-indigo-800"
                    }`}
                  >
                    {r.relationship_type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pricing Matrix Across Tiers & Currencies */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Tier × Currency Price Matrix</h2>

        {product.pricing.length === 0 ? (
          <p className="text-xs text-gray-500">No price list entries associated with this product.</p>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-gray-500 font-medium">Price List Name</th>
                  <th className="px-4 py-2 text-left text-gray-500 font-medium">Customer Tier</th>
                  <th className="px-4 py-2 text-left text-gray-500 font-medium">Currency</th>
                  <th className="px-4 py-2 text-right text-gray-500 font-medium">Configured Unit Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {product.pricing.map((pr) => (
                  <tr key={pr.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-800">{pr.price_list_name}</td>
                    <td className="px-4 py-2 text-gray-600">{pr.tier_name}</td>
                    <td className="px-4 py-2 font-bold text-gray-700">{pr.currency_code}</td>
                    <td className="px-4 py-2 text-right font-bold text-green-700">
                      {pr.currency_code} {Number(pr.unit_price).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Variant Modal */}
      {showVariantModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-lg font-bold mb-4">Add Variant to {product.name}</h2>
            <form onSubmit={handleAddVariant} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Variant SKU</label>
                <input
                  type="text"
                  required
                  placeholder={`${product.sku}-V1`}
                  value={varSku}
                  onChange={(e) => setVarSku(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Variant Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 100 Users License Pack"
                  value={varName}
                  onChange={(e) => setVarName(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Attribute Key</label>
                  <input
                    type="text"
                    value={varAttrKey}
                    onChange={(e) => setVarAttrKey(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Attribute Value</label>
                  <input
                    type="text"
                    value={varAttrVal}
                    onChange={(e) => setVarAttrVal(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowVariantModal(false)}
                  className="px-4 py-2 border rounded text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700">
                  Save Variant
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Relationship Modal */}
      {showRelModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-lg font-bold mb-4">Link Product Recommendation</h2>
            <form onSubmit={handleAddRelationship} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Target Related Product</label>
                <select
                  value={relProductId}
                  onChange={(e) => setRelProductId(Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {allProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Relationship Type</label>
                <select
                  value={relType}
                  onChange={(e) => setRelType(e.target.value as any)}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="CROSS_SELL">CROSS_SELL (Suggested add-on)</option>
                  <option value="UPSELL">UPSELL (Higher tier upgrade)</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRelModal(false)}
                  className="px-4 py-2 border rounded text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                  Link Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
