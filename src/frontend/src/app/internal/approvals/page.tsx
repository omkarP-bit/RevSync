"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";
import { useCurrency } from "@/components/CurrencyProvider";

interface ApprovalRequest {
  id: number;
  quotation_id: number;
  quotation_number: string;
  customer_name: string;
  currency_code: string;
  grand_total: number;
  status: string;
  risk_level: string;
  total_overage: number;
  submitted_by_name: string;
  submitted_at: string;
  decided_by_name: string | null;
  current_step: { sequence: number; role_id: number; role_name: string } | null;
}

const statusTabs = [
  { label: "All", value: "" },
  { label: "Pending", value: "PENDING_APPROVAL" },
  { label: "Approved", value: "APPROVED" },
  { label: "Rejected", value: "REJECTED" },
  { label: "Returned", value: "RETURNED" },
  { label: "Cancelled", value: "CANCELLED" },
];

const riskStyles: Record<string, string> = {
  LOW: "bg-green-100 text-green-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-red-100 text-red-800",
};

const statusStyles: Record<string, string> = {
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  RETURNED: "bg-purple-100 text-purple-800",
  CANCELLED: "bg-gray-100 text-gray-600",
};

export default function ApprovalsListPage() {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { format } = useCurrency();
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedStatus, setSelectedStatus] = useState("");

  const fetchApprovals = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: page.toString(), limit: "10" };
      if (selectedStatus) params.status = selectedStatus;

      const res = await api.get<ApiResponse<ApprovalRequest[]>>("/api/v1/approvals", params);
      setRequests(res.data);
      if (res.meta) {
        setTotalPages(res.meta.total_pages);
        setTotal(res.meta.total);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals();
  }, [page, selectedStatus]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Approval Workflow</h1>
        <p className="text-sm text-gray-500">
          Multi-step approval requests for quotations that exceed discount policy.
        </p>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex border-b border-gray-200 gap-2 overflow-x-auto text-sm">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setSelectedStatus(tab.value);
              setPage(1);
            }}
            className={`py-2 px-4 border-b-2 font-medium whitespace-nowrap transition ${
              selectedStatus === tab.value
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>}

      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-6 py-3 text-left">Request</th>
              <th className="px-6 py-3 text-left">Quote</th>
              <th className="px-6 py-3 text-left">Customer</th>
              <th className="px-6 py-3 text-left">Risk</th>
              <th className="px-6 py-3 text-right">Overage %</th>
              <th className="px-6 py-3 text-right">Grand Total</th>
              <th className="px-6 py-3 text-left">Current Step</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200 text-sm">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-6 py-6 text-center text-gray-500">
                  Loading approvals...
                </td>
              </tr>
            ) : requests.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-6 text-center text-gray-500">
                  No approval requests found for this filter.
                </td>
              </tr>
            ) : (
              requests.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-mono font-bold text-blue-700">AR-{String(r.id).padStart(4, "0")}</td>
                  <td className="px-6 py-4">
                    <Link href={`/internal/quotations/${r.quotation_id}`} className="font-mono text-blue-600 hover:underline">
                      {r.quotation_number}
                    </Link>
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900">{r.customer_name}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded ${riskStyles[r.risk_level] || "bg-gray-100 text-gray-700"}`}>
                      {r.risk_level}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-semibold text-red-600">
                    {Number(r.total_overage).toFixed(1)} pts
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-gray-900">
                    {format(r.grand_total)}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {r.current_step ? `Step ${r.current_step.sequence} · ${r.current_step.role_name}` : "-"}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded ${statusStyles[r.status] || "bg-gray-100 text-gray-700"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link href={`/internal/approvals/${r.id}`} className="text-blue-600 hover:text-blue-900 font-medium text-xs">
                      Review →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="px-6 py-3 flex items-center justify-between border-t border-gray-200 bg-gray-50 text-sm text-gray-500">
          <div>Showing {requests.length} of {total} requests</div>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1 border rounded bg-white disabled:opacity-50"
            >
              Previous
            </button>
            <span className="py-1">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1 border rounded bg-white disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}