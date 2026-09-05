"use client";

import { useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface Customer {
  id: number;
  name: string;
  email: string;
  company: string;
  status: string;
  tier_name: string;
  currency_code: string;
  created_at: string;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, total_pages: 0 });
  const [loading, setLoading] = useState(true);

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
      console.error("Failed to fetch customers", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Customers</h1>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm">
          + Add Customer
        </button>
      </div>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <table className="w-full bg-white rounded-lg shadow">
            <thead>
              <tr className="border-b text-left text-sm text-gray-500">
                <th className="p-3">Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">Company</th>
                <th className="p-3">Tier</th>
                <th className="p-3">Status</th>
                <th className="p-3">Currency</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3 text-gray-600">{c.email}</td>
                  <td className="p-3 text-gray-600">{c.company || "—"}</td>
                  <td className="p-3"><span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">{c.tier_name}</span></td>
                  <td className="p-3"><span className={`px-2 py-1 rounded text-xs ${c.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"}`}>{c.status}</span></td>
                  <td className="p-3 text-gray-600">{c.currency_code}</td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-gray-400">No customers found</td></tr>
              )}
            </tbody>
          </table>
          <div className="flex justify-between items-center mt-4 text-sm text-gray-500">
            <span>Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}</span>
            <div className="flex gap-2">
              <button disabled={meta.page <= 1} onClick={() => fetchCustomers(meta.page - 1)} className="px-3 py-1 border rounded disabled:opacity-50">Prev</button>
              <button disabled={meta.page >= meta.total_pages} onClick={() => fetchCustomers(meta.page + 1)} className="px-3 py-1 border rounded disabled:opacity-50">Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
