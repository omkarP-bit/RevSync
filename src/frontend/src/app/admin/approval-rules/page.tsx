"use client";

import { useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface ApprovalRule {
  id: number;
  risk_level: string;
  min_total_overage: number;
  role_sequence: number[];
  is_active: boolean;
}

const roleNames: Record<number, string> = {
  1: "Sales Rep",
  2: "Sales Manager",
  3: "Finance",
  4: "Warehouse Manager",
  5: "Admin",
};

export default function ApprovalRulesPage() {
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add rule form
  const [riskLevel, setRiskLevel] = useState("MEDIUM");
  const [minOverage, setMinOverage] = useState(5);
  const [roleSequence, setRoleSequence] = useState("2");

  const fetchRules = async () => {
    try {
      const res = await api.get<ApiResponse<ApprovalRule[]>>("/api/v1/approvals/rules");
      setRules(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load approval rules");
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await fetchRules();
      } catch (err: any) {
        setError(err.message || "Failed to load approval rules");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const sequence = roleSequence
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n) && n > 0);
    if (sequence.length === 0) {
      alert("Enter a role sequence, e.g. 2,3");
      return;
    }
    try {
      await api.post("/api/v1/approvals/rules", {
        risk_level: riskLevel,
        min_total_overage: minOverage,
        role_sequence: sequence,
      });
      setError("");
      await fetchRules();
    } catch (err: any) {
      alert(err.message || "Failed to create rule");
    }
  };

  const handleUpdate = async (rule: ApprovalRule, patch: Record<string, unknown>) => {
    try {
      await api.patch(`/api/v1/approvals/rules/${rule.id}`, patch);
      await fetchRules();
    } catch (err: any) {
      alert(err.message || "Failed to update rule");
    }
  };

  if (loading) return <div className="p-6 text-gray-500">Loading approval rules...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Approval Rules</h1>
        <p className="text-sm text-gray-500">
          When a quotation&apos;s discount overage reaches a threshold, it is routed through the role chain of the governing rule.
        </p>
      </div>

      {error && <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>}

      {/* Add rule */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Add Approval Rule</h2>
        <form onSubmit={handleAdd} className="grid md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Risk Level</label>
            <select
              value={riskLevel}
              onChange={(e) => setRiskLevel(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Min Overage (pts)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              required
              value={minOverage}
              onChange={(e) => setMinOverage(parseFloat(e.target.value) || 0)}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Approval Role Chain</label>
            <input
              type="text"
              required
              value={roleSequence}
              onChange={(e) => setRoleSequence(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm font-mono"
              placeholder="e.g. 2,3 (&quot;2&quot; = Sales Manager, &quot;3&quot; = Finance)"
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
              <th className="px-6 py-3 text-left">Risk Level</th>
              <th className="px-6 py-3 text-right">Min Overage (pts)</th>
              <th className="px-6 py-3 text-left">Approval Chain</th>
              <th className="px-6 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rules.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-400">
                  No approval rules configured yet.
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                      rule.risk_level === "HIGH"
                        ? "bg-red-100 text-red-800"
                        : rule.risk_level === "MEDIUM"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-green-100 text-green-800"
                    }`}>
                      {rule.risk_level}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={Number(rule.min_total_overage)}
                      onChange={(e) => handleUpdate(rule, { min_total_overage: parseFloat(e.target.value) || 0 })}
                      className="w-20 border rounded px-2 py-1 text-right font-bold text-gray-800"
                    />
                  </td>
                  <td className="px-6 py-4 text-gray-700 font-medium">
                    {(rule.role_sequence || []).map((r, i) => (
                      <span key={r}>
                        {i > 0 && <span className="text-gray-400"> → </span>}
                        {roleNames[r] || `Role ${r}`}
                      </span>
                    ))}
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