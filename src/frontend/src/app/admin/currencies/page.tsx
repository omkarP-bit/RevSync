"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<ApiResponse<Currency[]>>("/api/v1/currencies");
        setCurrencies(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Currencies</h1>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm">+ Add Currency</button>
      </div>
      {loading ? <p>Loading...</p> : (
        <table className="w-full bg-white rounded-lg shadow">
          <thead>
            <tr className="border-b text-left text-sm text-gray-500">
              <th className="p-3">Code</th>
              <th className="p-3">Name</th>
              <th className="p-3">Symbol</th>
              <th className="p-3">Active</th>
            </tr>
          </thead>
          <tbody>
            {currencies.map((c) => (
              <tr key={c.id} className="border-b hover:bg-gray-50">
                <td className="p-3 font-mono font-bold">{c.code}</td>
                <td className="p-3">{c.name}</td>
                <td className="p-3 text-lg">{c.symbol}</td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded text-xs ${c.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {c.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
