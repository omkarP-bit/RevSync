"use client";

import { useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface CreditTransaction {
  id: number;
  type: string;
  amount: number;
  reference_type?: string;
  reference_id?: number;
  description: string;
  created_at: string;
}

interface WalletData {
  id: number;
  balance: number;
  currency: string;
  transactions: CreditTransaction[];
}

export default function CustomerPortalWalletPage() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadWallet() {
      setLoading(true);
      try {
        const res = await api.get<ApiResponse<WalletData>>("/api/v1/portal/wallet");
        setWallet(res.data);
      } catch (err: any) {
        setError(err.message || "Failed to load wallet data");
      } finally {
        setLoading(false);
      }
    }
    loadWallet();
  }, []);

  const formatCurrency = (amount: number, curr = "USD") => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: curr }).format(amount);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Credit Wallet</h1>
        <p className="text-sm text-gray-500 mt-1">
          Prepaid credit balance generated from subscription cancellations, proration adjustments, and wallet transactions
        </p>
      </div>

      {error && <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm">{error}</div>}

      {loading ? (
        <div className="p-12 text-center text-gray-400">Loading credit wallet...</div>
      ) : !wallet ? (
        <div className="p-12 text-center text-gray-400">No wallet data available</div>
      ) : (
        <>
          {/* Balance Card */}
          <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-8 rounded-3xl text-white shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs uppercase tracking-widest font-semibold text-emerald-200">
                Available Credit Wallet Balance
              </span>
              <div className="text-4xl font-extrabold mt-2">
                {formatCurrency(wallet.balance, wallet.currency)}
              </div>
              <p className="text-xs text-emerald-100 mt-2">
                Automatically applied as an offset against future invoices at checkout.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-md px-5 py-3 rounded-2xl border border-white/20 text-right text-xs">
              <span className="block text-emerald-200 font-semibold">Wallet Status</span>
              <span className="text-sm font-bold text-white">Active</span>
            </div>
          </div>

          {/* Transactions Ledger */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-2xs p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Credit Transaction History</h3>
            {wallet.transactions.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No credit transactions recorded yet.</p>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Transaction Type</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {wallet.transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50/80">
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{formatDate(tx.created_at)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2.5 py-0.5 text-2xs font-bold rounded-full ${
                              tx.amount > 0
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-indigo-100 text-indigo-800"
                            }`}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-800">{tx.description}</td>
                        <td className="px-4 py-3 text-right font-bold font-mono">
                          <span className={tx.amount > 0 ? "text-emerald-600" : "text-indigo-600"}>
                            {tx.amount > 0 ? "+" : ""}
                            {formatCurrency(tx.amount, wallet.currency)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
