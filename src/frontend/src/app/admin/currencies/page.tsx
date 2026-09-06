"use client";

import { useEffect, useState, useCallback } from "react";
import { api, ApiResponse } from "@/lib/api";

interface Currency {
  id: number;
  code: string;
  name: string;
  symbol: string;
  is_active: boolean;
}

export default function CurrenciesPage() {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchCurrencies = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<Currency[]>>("/api/v1/currencies", {
        page: p.toString(),
        limit: "10",
      });
      setCurrencies(res.data);
      if (res.meta) {
        setTotalPages(res.meta.total_pages);
        setTotal(res.meta.total);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchCurrencies(page);
  }, [page, fetchCurrencies]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Currencies</h1>
          <p className="text-xs text-gray-500">Configure global transaction & billing currencies.</p>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-gray-500">Loading currencies...</div>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-gray-500 bg-gray-50">
                  <th className="p-3 pl-4">Code</th>
                  <th className="p-3">Name</th>
                  <th className="p-3">Symbol</th>
                  <th className="p-3 pr-4">Active</th>
                </tr>
              </thead>
              <tbody>
                {currencies.map((c) => (
                  <tr key={c.id} className="border-b hover:bg-gray-50 transition">
                    <td className="p-3 pl-4 font-mono font-bold text-gray-900">{c.code}</td>
                    <td className="p-3 text-sm text-gray-800">{c.name}</td>
                    <td className="p-3 text-lg text-gray-900 font-semibold">{c.symbol}</td>
                    <td className="p-3 pr-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          c.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {c.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
                {currencies.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-gray-400 text-sm">
                      No currencies configured yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="flex justify-between items-center text-sm text-gray-500 pt-2">
            <span>
              Showing Page {page} of {totalPages} ({total} total currencies)
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 border border-gray-300 rounded bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 border border-gray-300 rounded bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
