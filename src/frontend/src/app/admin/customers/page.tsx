"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";

interface Customer {
  id: number;
  name: string;
  email: string;
  company: string;
  status: string;
  tier_name: string;
  currency_code: string;
  customer_type: string;
  expected_po_value: string;
  payment_terms: string;
  upfront_payment_pct: string;
  created_at: string;
}

interface TierEvaluation {
  customer_id: number;
  recommended_tier: string;
  matched_rules: { rule_name: string; reason: string }[];
  input: {
    customer_type: string;
    expected_po_value: number;
    payment_terms: string;
    upfront_payment_pct: number;
  };
}

const TIERS = ["BRONZE", "SILVER", "GOLD"];

const PAYMENT_TERMS: Record<string, { label: string; hint: string }> = {
  NET_15: { label: "Net 15", hint: "Customer pays in full within 15 days of invoice date" },
  NET_30: { label: "Net 30", hint: "Customer pays in full within 30 days of invoice date" },
  NET_60: { label: "Net 60", hint: "Customer pays in full within 60 days of invoice date" },
  ADVANCE: { label: "Advance", hint: "Customer pays the full amount before delivery" },
  COD: { label: "Cash on Delivery", hint: "Customer pays at the point of delivery" },
};

function PaymentLabel({ value }: { value: string }) {
  const info = PAYMENT_TERMS[value] ?? { label: value, hint: "Custom payment terms" };
  return (
    <span title={`${info.label}: ${info.hint}`} className="underline decoration-dotted underline-offset-2 cursor-help">
      {info.label}
    </span>
  );
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, total_pages: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [evaluation, setEvaluation] = useState<TierEvaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [overrideTier, setOverrideTier] = useState("GOLD");
  const [overrideReason, setOverrideReason] = useState("");

  const fetchCustomers = async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<Customer[]>>("/api/v1/customers", {
        page: String(page),
        limit: "20",
      });
      setCustomers(res.data);
      if (res.meta) setMeta(res.meta);
    } catch (err) {
      setNote("Failed to fetch customers: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const evaluate = async (c: Customer) => {
    setSelected(c);
    setEvaluation(null);
    setNote(null);
    setBusy(true);
    try {
      const res = await api.post<ApiResponse<TierEvaluation>>(
        `/api/v1/customers/${c.id}/tier/evaluate`
      );
      setEvaluation(res.data);
    } catch (err) {
      setNote("Evaluation failed: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!selected) return;
    setBusy(true);
    setNote(null);
    try {
      await api.post(`/api/v1/customers/${selected.id}/tier/confirm`);
      setNote(`Tier ${evaluation?.recommended_tier} confirmed for ${selected.name}.`);
      setSelected(null);
      setEvaluation(null);
      fetchCustomers();
    } catch (err) {
      setNote("Confirm failed: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const override = async () => {
    if (!selected) return;
    if (!overrideReason.trim()) {
      setNote("An override reason is required.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await api.post(`/api/v1/customers/${selected.id}/tier/override`, {
        requested_tier: overrideTier,
        reason: overrideReason,
      });
      setNote(`Tier overridden to ${overrideTier} for ${selected.name}.`);
      setSelected(null);
      setEvaluation(null);
      setOverrideReason("");
      fetchCustomers();
    } catch (err) {
      setNote("Override failed: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setSelected(null);
    setEvaluation(null);
    setNote(null);
    setOverrideReason("");
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Customers Directory</h1>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm">
          + Add Customer
        </button>
      </div>

      {note && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded text-sm">{note}</div>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <div className="overflow-x-auto bg-white rounded-lg shadow">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-gray-500">
                  <th className="p-3">Name</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Tier</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Expected PO</th>
                  <th className="p-3">Payment Terms</th>
                  <th className="p-3">Upfront %</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-medium">{c.name}</td>
                    <td className="p-3 text-gray-600">{c.email}</td>
                    <td className="p-3"><span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">{c.tier_name}</span></td>
                    <td className="p-3 text-sm text-gray-600">{c.customer_type}</td>
                    <td className="p-3 text-sm text-gray-600">{Number(c.expected_po_value).toLocaleString()}</td>
                    <td className="p-3 text-sm text-gray-600"><PaymentLabel value={c.payment_terms} /></td>
                    <td className="p-3 text-sm text-gray-600">{c.upfront_payment_pct}%</td>
                    <td className="p-3"><span className={`px-2 py-1 rounded text-xs ${c.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"}`}>{c.status}</span></td>
                    <td className="p-3 text-right flex items-center justify-end gap-3">
                      <button
                        onClick={() => evaluate(c)}
                        className="text-purple-600 hover:text-purple-800 font-semibold text-xs"
                      >
                        Evaluate Tier
                      </button>
                      <Link
                        href={`/internal/quotations?customer_id=${c.id}`}
                        className="text-blue-600 hover:text-blue-900 font-semibold text-xs hover:underline"
                      >
                        View Quotes &rarr;
                      </Link>
                    </td>
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr><td colSpan={9} className="p-6 text-center text-gray-400">No customers found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center mt-4 text-sm text-gray-500">
            <span>Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}</span>
            <div className="flex gap-2">
              <button disabled={meta.page <= 1} onClick={() => fetchCustomers(meta.page - 1)} className="px-3 py-1 border rounded disabled:opacity-50">Prev</button>
              <button disabled={meta.page >= meta.total_pages} onClick={() => fetchCustomers(meta.page + 1)} className="px-3 py-1 border rounded disabled:opacity-50">Next</button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center p-6 overflow-auto z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 mt-10">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Tier Evaluation — {selected.name}</h2>
              <button onClick={close} className="text-gray-500 hover:text-gray-800 font-bold">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-sm bg-gray-50 p-4 rounded-lg">
              <div><span className="text-gray-500">Type:</span> <b>{selected.customer_type}</b></div>
              <div><span className="text-gray-500">Payment terms:</span> <b><PaymentLabel value={selected.payment_terms} /></b></div>
              <div><span className="text-gray-500">Expected PO value:</span> <b>{Number(selected.expected_po_value).toLocaleString()}</b></div>
              <div><span className="text-gray-500">Upfront payment:</span> <b>{selected.upfront_payment_pct}%</b></div>
            </div>

            {busy && <p className="text-sm text-gray-500 mb-3">Evaluating rules...</p>}

            {evaluation && (
              <div className="mb-4">
                <div className="p-4 rounded-lg border-2 border-purple-300 bg-purple-50">
                  <p className="text-xs font-semibold text-purple-600 uppercase">Recommended tier</p>
                  <p className="text-3xl font-extrabold text-purple-800">{evaluation.recommended_tier}</p>
                </div>
                <h3 className="text-sm font-semibold text-gray-700 mt-4 mb-2">Matched rules</h3>
                {evaluation.matched_rules.length === 0 ? (
                  <p className="text-sm text-gray-500">No specific rule matched; defaulting to BRONZE.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {evaluation.matched_rules.map((r, i) => (
                      <li key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <b>{r.rule_name}</b>
                        <p className="text-gray-600 text-xs mt-1">{r.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {evaluation && (
              <div className="flex flex-wrap gap-3 border-t pt-4">
                <button
                  onClick={confirm}
                  disabled={busy}
                  className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 text-sm font-semibold disabled:opacity-50"
                >
                  Confirm {evaluation.recommended_tier}
                </button>
                <div className="flex items-end gap-2">
                  <div>
                    <label className="text-xs text-gray-500 block">Override to</label>
                    <select
                      value={overrideTier}
                      onChange={(e) => setOverrideTier(e.target.value)}
                      className="border rounded px-2 py-1.5 text-sm"
                    >
                      {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <input
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Override reason (required)"
                    className="border rounded px-2 py-1.5 text-sm w-56"
                  />
                  <button
                    onClick={override}
                    disabled={busy}
                    className="bg-amber-600 text-white px-4 py-2 rounded-md hover:bg-amber-700 text-sm font-semibold disabled:opacity-50"
                  >
                    Override (Manager)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
