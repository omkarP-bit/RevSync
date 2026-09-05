"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface NegotiationRow {
  id: number;
  public_id: string;
  quotation_number: string;
  currency_code: string;
  grand_total: number;
  quotation_status: string;
  negotiation_status: string;
  updated_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-100 text-gray-700",
};

export default function PortalPage() {
  const router = useRouter();
  const [negotiations, setNegotiations] = useState<NegotiationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get<ApiResponse<NegotiationRow[]>>("/api/v1/portal/negotiations", { limit: "100" });
      setNegotiations(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load your quotes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="w-full space-y-4">
      <div className="pb-2 border-b border-gray-200">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">My Quotations</h1>
        <p className="text-xs text-gray-500">Active negotiations on your quotes with RevSync.</p>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading...</div>
        ) : negotiations.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            You have no active quotations right now.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
              <tr>
                <th className="px-6 py-3 text-left">Quote #</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-right">Total</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200 text-sm">
              {negotiations.map((n) => (
                <tr key={n.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/portal/negotiations/${n.public_id}`)}>
                  <td className="px-6 py-4 font-mono font-bold text-blue-700">{n.quotation_number}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${STATUS_BADGE[n.negotiation_status] || "bg-gray-100 text-gray-700"}`}>
                      {n.negotiation_status}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">{n.quotation_status}</span>
                  </td>
                  <td className="px-6 py-4 text-right font-extrabold text-gray-900">
                    {n.currency_code} {Number(n.grand_total).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-purple-600 font-semibold text-xs inline-flex items-center gap-1">
                      Negotiate &rarr;
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}