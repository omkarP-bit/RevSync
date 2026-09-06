"use client";

import { useEffect, useState, useCallback } from "react";
import { api, ApiResponse } from "@/lib/api";

interface SignalSnapshot {
  key: string;
  label: string;
  weight: number;
  enabled: boolean;
  severity: number;
  contribution: number;
  reason: string;
}

interface DealSnapshot {
  id: number;
  public_id: string;
  quotation_id: number;
  customer_id: number;
  sales_rep_id: number;
  status: string;
  score: number;
  signals: SignalSnapshot[];
  computed_at: string;
  quotation_number: string;
  customer_name: string;
  sales_rep_email: string;
}

interface SignalConfig {
  key: string;
  name: string;
  description: string;
  weight: number;
  is_enabled: boolean;
  updated_at: string;
}

interface Overview {
  counts: Record<string, number>;
  total: number;
  avg_score: number;
}

const statusTabs = [
  { label: "All", value: "" },
  { label: "Healthy", value: "HEALTHY" },
  { label: "At Risk", value: "AT_RISK" },
  { label: "Critical", value: "CRITICAL" },
];

const statusStyles: Record<string, string> = {
  HEALTHY: "bg-green-100 text-green-800",
  AT_RISK: "bg-yellow-100 text-yellow-800",
  CRITICAL: "bg-red-100 text-red-800",
};

const scoreColor = (score: number) =>
  score < 30 ? "text-green-600" : score < 70 ? "text-yellow-600" : "text-red-600";

export default function DealHealthPage() {
  const [snapshots, setSnapshots] = useState<DealSnapshot[]>([]);
  const [overview, setOverview] = useState<Overview>({ counts: {}, total: 0, avg_score: 0 });
  const [config, setConfig] = useState<SignalConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedStatus, setSelectedStatus] = useState("");
  const [userRoleId, setUserRoleId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const canManage = userRoleId === 2 || userRoleId === 3 || userRoleId === 5;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: page.toString(), limit: "10" };
      if (selectedStatus) params.status = selectedStatus;
      const [listRes, overviewRes, configRes] = await Promise.all([
        api.get<ApiResponse<DealSnapshot[]>>("/api/v1/deal-health", params),
        api.get<ApiResponse<Overview>>("/api/v1/deal-health/overview"),
        api.get<ApiResponse<SignalConfig[]>>("/api/v1/deal-health/config"),
      ]);
      setSnapshots(listRes.data);
      if (listRes.meta) setTotalPages(listRes.meta.total_pages);
      setOverview(overviewRes.data);
      setConfig(configRes.data);
    } catch (err: any) {
      setError(err.message || "Failed to load deal health");
    } finally {
      setLoading(false);
    }
  }, [page, selectedStatus]);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) {
      try {
        setUserRoleId(JSON.parse(stored).role_id ?? null);
      } catch {
        setUserRoleId(null);
      }
    }
    fetchAll();
  }, [fetchAll]);

  const refreshScores = async () => {
    setRefreshing(true);
    try {
      await api.post<ApiResponse<{ refreshed: number }>>("/api/v1/deal-health/refresh");
      await fetchAll();
      alert("Deal health refreshed.");
    } catch (err: any) {
      alert(err.message || "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  };

  const updateWeight = async (key: string, weight: number, is_enabled: boolean) => {
    setSavingKey(key);
    try {
      await api.patch<ApiResponse<SignalConfig>>(`/api/v1/deal-health/config/${key}`, { weight, is_enabled });
      await fetchAll();
    } catch (err: any) {
      alert(err.message || "Failed to update config");
    } finally {
      setSavingKey(null);
    }
  };

  const renderOverviewCards = () => {
    const cards = [
      { label: "Healthy", value: overview.counts["HEALTHY"] ?? 0, cls: "text-green-600" },
      { label: "At Risk", value: overview.counts["AT_RISK"] ?? 0, cls: "text-yellow-600" },
      { label: "Critical", value: overview.counts["CRITICAL"] ?? 0, cls: "text-red-600" },
      { label: "Total Deals", value: overview.total, cls: "text-gray-800" },
      { label: "Avg Score", value: (overview.avg_score ?? 0).toFixed(1), cls: scoreColor(overview.avg_score ?? 0) },
    ];
    return cards.map((c) => (
      <div key={c.label} className="bg-white rounded-lg shadow p-4">
        <div className="text-xs uppercase tracking-wide text-gray-500">{c.label}</div>
        <div className={`text-3xl font-bold ${c.cls}`}>{c.value}</div>
      </div>
    ));
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Deal Health</h1>
          <p className="text-gray-500 text-sm">Track the health of every open deal with configurable signal weights.</p>
        </div>
        <div className="flex gap-3">
          {canManage && (
            <>
              <button
                onClick={() => setShowConfig(true)}
                className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-800 text-sm"
              >
                Configure Weights
              </button>
              <button
                onClick={refreshScores}
                disabled={refreshing}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">{renderOverviewCards()}</div>

      <div className="flex flex-wrap gap-2 mb-4">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setSelectedStatus(tab.value);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              selectedStatus === tab.value ? "bg-blue-600 text-white" : "bg-white text-gray-700 border hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</div>}

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Quotation</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Sales Rep</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Computed</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No deal health snapshots. Click &quot;Refresh&quot; to compute.
                  </td>
                </tr>
              ) : (
                snapshots.map((s) => (
                  <FragmentRow
                    key={s.id}
                    s={s}
                    expanded={expanded === s.id}
                    onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="px-4 py-2 bg-white border rounded text-sm disabled:opacity-50"
          >
            Prev
          </button>
          <span className="px-4 py-2 text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="px-4 py-2 bg-white border rounded text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {showConfig && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Signal Weights</h2>
              <button onClick={() => setShowConfig(false)} className="text-gray-500 hover:text-gray-800 text-xl">
                &times;
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Weights sum to 100 and are normalized automatically. Severity 0–1 per signal; score = sum of weight ×
              severity, normalized to the enabled weight total. Healthy &lt; 30 · At Risk &lt; 70 · Critical ≥ 70.
            </p>
            {config.map((c) => (
              <div key={c.key} className="border rounded-lg p-3 mb-3">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-gray-500">{c.description}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={!c.is_enabled}
                      value={c.weight}
                      onChange={(e) => updateWeight(c.key, Number(e.target.value), c.is_enabled)}
                      className="w-20 border rounded px-2 py-1 text-right disabled:bg-gray-100"
                    />
                    <button
                      onClick={() => updateWeight(c.key, c.weight, !c.is_enabled)}
                      disabled={savingKey === c.key}
                      className={`px-3 py-1 rounded text-xs font-medium ${
                        c.is_enabled ? "bg-gray-700 text-white" : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {c.is_enabled ? "Enabled" : "Disabled"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowConfig(false)} className="px-4 py-2 bg-gray-200 rounded text-sm">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  s,
  expanded,
  onToggle,
}: {
  s: DealSnapshot;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
      >
        <td className="px-4 py-3 font-medium">{s.quotation_number}</td>
        <td className="px-4 py-3">{s.customer_name || "—"}</td>
        <td className="px-4 py-3">{s.sales_rep_email || "—"}</td>
        <td className="px-4 py-3">
          <span className={`px-2 py-1 rounded text-xs font-semibold ${statusStyles[s.status] || "bg-gray-100 text-gray-700"}`}>
            {s.status.replace("_", " ")}
          </span>
        </td>
        <td className={`px-4 py-3 font-bold ${scoreColor(s.score ?? 0)}`}>{(s.score ?? 0).toFixed(0)}</td>
        <td className="px-4 py-3 text-gray-500">{new Date(s.computed_at).toLocaleString()}</td>
      </tr>
      {expanded && (
        <tr className="border-t border-gray-100 bg-gray-50">
          <td colSpan={6} className="px-6 py-4">
            <div className="text-xs font-semibold uppercase text-gray-500 mb-2">Signal Breakdown</div>
            {(s.signals || []).length === 0 ? (
              <div className="text-sm text-gray-500 italic">No signal details recorded for this snapshot.</div>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {(s.signals || []).map((sig) => {
                  const contribution = Number(sig.contribution ?? (sig.severity ?? 0));
                  const severity = Number(sig.severity ?? 0);
                  const label = sig.label || sig.key || "Signal";
                  const reason = sig.reason || "Signal evaluated";
                  return (
                    <div key={sig.key} className="border rounded p-3 bg-white">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{label}</span>
                        <span className="text-xs font-semibold text-gray-600">
                          {sig.enabled ? `contribution ${contribution.toFixed(1)}` : "disabled"}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded h-2 my-2">
                        <div
                          className={`h-2 rounded ${severity >= 0.7 ? "bg-red-500" : severity >= 0.3 ? "bg-yellow-500" : "bg-green-500"}`}
                          style={{ width: `${(sig.enabled ? severity : 0) * 100}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-500">{reason}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
