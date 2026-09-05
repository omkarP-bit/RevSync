"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface PortalInvoice {
  invoice_number: string;
  public_id: string;
  quotation_number: string;
  status: string;
  issue_date: string;
  due_date: string;
  grand_total: number;
  total_paid: number;
  balance_due: number;
}

const STATUS_BADGE: Record<string, string> = {
  ISSUED: "bg-blue-100 text-blue-800",
  PARTIALLY_PAID: "bg-yellow-100 text-yellow-800",
  PAID: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-700",
};

export default function PortalInvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get<ApiResponse<PortalInvoice[]>>("/api/v1/portal/invoices", { limit: "100" });
      setInvoices(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load your invoices");
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
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">My Invoices</h1>
        <p className="text-xs text-gray-500">Invoices and payment status for your orders.</p>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading...</div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            You have no invoices right now.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
              <tr>
                <th className="px-6 py-3 text-left">Invoice #</th>
                <th className="px-6 py-3 text-left">Quote</th>
                <th className="px-6 py-3 text-left">Due Date</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-right">Total</th>
                <th className="px-6 py-3 text-right">Balance Due</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200 text-sm">
              {invoices.map((inv) => (
                <tr key={inv.public_id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/portal/invoices/${inv.public_id}`)}>
                  <td className="px-6 py-4 font-mono font-bold text-blue-700">{inv.invoice_number}</td>
                  <td className="px-6 py-4 font-mono text-gray-500">{inv.quotation_number}</td>
                  <td className="px-6 py-4 text-gray-600">{new Date(inv.due_date).toLocaleDateString()}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${STATUS_BADGE[inv.status] || "bg-gray-100 text-gray-700"}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-extrabold text-gray-900">
                    ${Number(inv.grand_total).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right font-semibold text-red-600">
                    ${Number(inv.balance_due).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-blue-600 font-semibold text-xs">View &rarr;</span>
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