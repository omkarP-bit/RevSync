"use client";

import { useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

export interface Customer {
  id: number;
  name: string;
  email: string;
  company?: string;
  phone?: string;
  status: string;
  tier_id: number;
  tier_name?: string;
  calculated_tier_name?: string;
  override_tier_name?: string;
  currency_code: string;
  customer_type?: string;
  expected_po_value?: number;
  payment_terms?: string;
  upfront_payment_pct?: number;
  credit_limit?: number;
  billing_address?: string;
  shipping_address?: string;
  created_at?: string;
}

interface TierOption {
  id: number;
  name: string;
}

interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

interface TierPreviewResponse {
  recommended_tier: string;
  matched_rules: { rule_name: string; reason: string }[];
}

interface CustomerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newCustomer: Customer) => void;
}

export function CustomerFormModal({ isOpen, onClose, onSuccess }: CustomerFormModalProps) {
  const [userRoleId, setUserRoleId] = useState<number>(1);
  const [tiers, setTiers] = useState<TierOption[]>([
    { id: 1, name: "Bronze" },
    { id: 2, name: "Silver" },
    { id: 3, name: "Gold" },
  ]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([
    { code: "USD", name: "US Dollar", symbol: "$" },
    { code: "EUR", name: "Euro", symbol: "€" },
    { code: "GBP", name: "British Pound", symbol: "£" },
    { code: "INR", name: "Indian Rupee", symbol: "₹" },
  ]);

  // Form State
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tierId, setTierId] = useState<number>(1);
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [customerType, setCustomerType] = useState("BUSINESS");
  const [paymentTerms, setPaymentTerms] = useState("NET_30");
  const [expectedPoValue, setExpectedPoValue] = useState<number>(0);
  const [creditLimit, setCreditLimit] = useState<number>(0);
  const [upfrontPaymentPct, setUpfrontPaymentPct] = useState<number>(0);
  const [billingAddress, setBillingAddress] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [sameAsBilling, setSameAsBilling] = useState(false);

  // Live Tier Preview State
  const [previewTier, setPreviewTier] = useState<string>("BRONZE");
  const [previewRules, setPreviewRules] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const uStr = localStorage.getItem("user");
      if (uStr) {
        const u = JSON.parse(uStr);
        if (u.role_id) setUserRoleId(u.role_id);
      }
    } catch {
      // ignore
    }
  }, []);

  const isSalesRep = userRoleId === 1;

  useEffect(() => {
    if (!isOpen) return;
    fetchTiersAndCurrencies();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    fetchLiveTierPreview();
  }, [isOpen, customerType, upfrontPaymentPct, expectedPoValue, paymentTerms]);

  const fetchTiersAndCurrencies = async () => {
    try {
      const tierRes = await api.get<ApiResponse<TierOption[]>>("/api/v1/customers/tiers");
      if (tierRes.data && tierRes.data.length > 0) {
        setTiers(tierRes.data);
        setTierId(tierRes.data[0].id);
      }
    } catch {
      // Use defaults
    }

    try {
      const currRes = await api.get<ApiResponse<CurrencyOption[]>>("/api/v1/currencies");
      if (currRes.data && currRes.data.length > 0) {
        setCurrencies(currRes.data);
      }
    } catch {
      // Use defaults
    }
  };

  const fetchLiveTierPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await api.post<ApiResponse<TierPreviewResponse>>("/api/v1/customers/evaluate-preview", {
        customer_type: customerType,
        upfront_payment_pct: upfrontPaymentPct,
        expected_po_value: expectedPoValue,
        payment_terms: paymentTerms,
      });
      setPreviewTier(res.data.recommended_tier);
      setPreviewRules(res.data.matched_rules.map((r) => r.rule_name));

      // Match calculated tier ID
      const matched = tiers.find((t) => t.name.toUpperCase() === res.data.recommended_tier.toUpperCase());
      if (matched && isSalesRep) {
        setTierId(matched.id);
      }
    } catch {
      // ignore preview errors
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSameAsBillingChange = (checked: boolean) => {
    setSameAsBilling(checked);
    if (checked) {
      setShippingAddress(billingAddress);
    }
  };

  const handleBillingAddressChange = (val: string) => {
    setBillingAddress(val);
    if (sameAsBilling) {
      setShippingAddress(val);
    }
  };

  const resetForm = () => {
    setName("");
    setCompany("");
    setEmail("");
    setPhone("");
    setTierId(tiers[0]?.id || 1);
    setCurrencyCode("USD");
    setCustomerType("BUSINESS");
    setPaymentTerms("NET_30");
    setExpectedPoValue(0);
    setCreditLimit(0);
    setUpfrontPaymentPct(0);
    setBillingAddress("");
    setShippingAddress("");
    setSameAsBilling(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Contact Name is required");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Valid Email is required");
      return;
    }
    if (!isSalesRep && creditLimit < 0) {
      setError("Credit Limit cannot be negative");
      return;
    }
    if (expectedPoValue < 0) {
      setError("Expected PO Value cannot be negative");
      return;
    }
    if (upfrontPaymentPct < 0 || upfrontPaymentPct > 100) {
      setError("Upfront Payment % must be between 0 and 100");
      return;
    }

    setLoading(true);

    try {
      const payload: Record<string, any> = {
        name: name.trim(),
        company: company.trim() || undefined,
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        currency_code: currencyCode,
        customer_type: customerType,
        payment_terms: paymentTerms,
        expected_po_value: Number(expectedPoValue),
        upfront_payment_pct: Number(upfrontPaymentPct),
        billing_address: billingAddress.trim() || undefined,
        shipping_address: sameAsBilling ? billingAddress.trim() || undefined : shippingAddress.trim() || undefined,
        status: "ACTIVE",
      };

      if (!isSalesRep) {
        payload.tier_id = Number(tierId);
        payload.credit_limit = Number(creditLimit);
      }

      const res = await api.post<ApiResponse<Customer>>("/api/v1/customers", payload);
      resetForm();
      onSuccess(res.data);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create customer");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 border border-slate-200 my-8">
        <div className="flex justify-between items-center pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Create New Customer</h2>
            <p className="text-xs text-slate-500 mt-0.5">Enter customer contact details, commercial terms, and addresses.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 font-bold p-1 text-lg">
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-6">
          {/* CUSTOMER INFORMATION */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Customer Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Company Name</label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Acme Corporation"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Contact Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@acme.com"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* COMMERCIAL DETAILS */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Commercial Inputs</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Customer Type *</label>
                <select
                  value={customerType}
                  onChange={(e) => setCustomerType(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-50 font-semibold"
                >
                  <option value="BUSINESS">BUSINESS</option>
                  <option value="ENTERPRISE">ENTERPRISE</option>
                  <option value="INDIVIDUAL">INDIVIDUAL</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Currency *</label>
                <select
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-semibold focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-50"
                >
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.symbol}) — {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Payment Terms</label>
                <select
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-50"
                >
                  <option value="NET_30">Net 30</option>
                  <option value="NET_15">Net 15</option>
                  <option value="NET_60">Net 60</option>
                  <option value="ADVANCE">Advance</option>
                  <option value="COD">Cash on Delivery</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Expected PO Value</label>
                <input
                  type="number"
                  min="0"
                  value={expectedPoValue}
                  onChange={(e) => setExpectedPoValue(parseFloat(e.target.value) || 0)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Upfront Payment %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={upfrontPaymentPct}
                  onChange={(e) => setUpfrontPaymentPct(parseFloat(e.target.value) || 0)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none font-bold"
                />
              </div>

              {!isSalesRep && (
                <div>
                  <label className="block font-bold text-amber-800 mb-1">Credit Limit (Manager)</label>
                  <input
                    type="number"
                    min="0"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(parseFloat(e.target.value) || 0)}
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-none bg-amber-50/40"
                  />
                </div>
              )}

              {!isSalesRep && (
                <div>
                  <label className="block font-bold text-amber-800 mb-1">Tier Override (Manager)</label>
                  <select
                    value={tierId}
                    onChange={(e) => setTierId(Number(e.target.value))}
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 text-slate-900 font-semibold focus:ring-2 focus:ring-amber-500 focus:outline-none bg-amber-50/40"
                  >
                    {tiers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} Tier
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* CALCULATED TIER CARD DISPLAY */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex items-center justify-between shadow-xs">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 block">Calculated Customer Tier</span>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-extrabold text-purple-900">{previewTier}</span>
                {previewLoading && <span className="text-xs text-purple-400 font-mono">Evaluating...</span>}
              </div>
              <p className="text-[11px] text-purple-700 mt-1">
                {previewRules.length > 0
                  ? `Matched: ${previewRules.join(", ")}`
                  : "Automatically evaluated from customer inputs by RevSync Tier Engine."}
              </p>
            </div>
            <div className="text-right">
              <span className="bg-purple-200 text-purple-800 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase font-mono">
                {isSalesRep ? "Server Evaluated" : "Engine Recommendation"}
              </span>
            </div>
          </div>

          {/* ADDRESS */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Addresses</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Billing Address</label>
                <textarea
                  rows={2}
                  value={billingAddress}
                  onChange={(e) => handleBillingAddressChange(e.target.value)}
                  placeholder="123 Corporate Blvd, Suite 400, City, Country"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sameAsBilling"
                  checked={sameAsBilling}
                  onChange={(e) => handleSameAsBillingChange(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="sameAsBilling" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Shipping address is the same as billing address
                </label>
              </div>

              {!sameAsBilling && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Shipping Address</label>
                  <textarea
                    rows={2}
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    placeholder="Shipment Center Dock 4, Warehouse Ave..."
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>

          {/* ACTIONS */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl text-xs font-extrabold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition shadow-sm"
            >
              {loading ? "Creating Customer..." : "Create Customer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

