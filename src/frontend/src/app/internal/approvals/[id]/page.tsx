"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";
import { exportApprovalPdf } from "@/lib/pdf";
import { useCurrency } from "@/components/CurrencyProvider";

interface ApprovalStep {
  id: number;
  sequence: number;
  role_id: number;
  role_name: string;
  status: string;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  notes: string | null;
}

interface ApprovalDetail {
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
  decided_at: string | null;
  notes: string | null;
  steps: ApprovalStep[];
}

const riskStyles: Record<string, string> = {
  LOW: "bg-green-100 text-green-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-red-100 text-red-800",
};

const stepStatusStyles: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  SKIPPED: "bg-gray-100 text-gray-500",
};

export default function ApprovalDetailPage() {
  const params = useParams();
  const approvalId = params?.id as string;

  const [approval, setApproval] = useState<ApprovalDetail | null>(null);
  const [userRoleId, setUserRoleId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");
  const [acting, setActing] = useState(false);
  const { format } = useCurrency();

  const fetchApproval = async () => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<ApprovalDetail>>(`/api/v1/approvals/${approvalId}`);
      setApproval(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load approval");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) {
      try {
        setUserRoleId(JSON.parse(stored).role_id ?? null);
      } catch {
        setUserRoleId(null);
      }
    }
    if (approvalId) fetchApproval();
  }, [approvalId]);

  const pendingStep = approval?.steps.find((s) => s.status === "PENDING") ?? null;
  const canDecide =
    approval?.status === "PENDING_APPROVAL" &&
    pendingStep !== null &&
    userRoleId !== null &&
    pendingStep.role_id === userRoleId;

  const decide = async (action: "approve" | "reject" | "return") => {
    setActing(true);
    try {
      await api.post(`/api/v1/approvals/${approvalId}/${action}`, { notes: notes || undefined });
      setNotes("");
      await fetchApproval();
    } catch (err: any) {
      alert(err.message || `Failed to ${action}`);
    } finally {
      setActing(false);
    }
  };

  if (loading) return <div className="p-6 text-gray-500">Loading approval detail...</div>;
  if (error || !approval) return <div className="p-6 text-red-600">{error || "Approval not found"}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/internal/approvals" className="text-gray-500 hover:text-gray-700 text-sm">
            ← Back to Approvals
          </Link>
          <span className="text-gray-300">|</span>
          <span className="font-mono text-xs font-bold text-blue-700">
            AR-{String(approval.id).padStart(4, "0")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportApprovalPdf(approval)}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 text-sm font-medium"
          >
            ⬇ Export PDF
          </button>
          <span className={`px-2 py-1 text-xs font-semibold rounded ${riskStyles[approval.risk_level] || "bg-gray-100 text-gray-700"}`}>
            {approval.risk_level} RISK
          </span>
          <span className={`px-2 py-1 text-xs font-semibold rounded ${
            approval.status === "PENDING_APPROVAL" ? "bg-yellow-100 text-yellow-800"
            : approval.status === "APPROVED" ? "bg-green-100 text-green-800"
            : approval.status === "REJECTED" ? "bg-red-100 text-red-800"
            : "bg-gray-100 text-gray-600"
          }`}>
            {approval.status}
          </span>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{approval.customer_name}</h1>
            <p className="text-xs text-gray-500 mt-1">
              Submitted by <strong>{approval.submitted_by_name}</strong> on{" "}
              {new Date(approval.submitted_at).toLocaleString()} · Overage{" "}
              <strong className="text-red-600">{Number(approval.total_overage).toFixed(1)} pts</strong>
            </p>
          </div>
          <Link
            href={`/internal/quotations/${approval.quotation_id}`}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
          >
            Open Quotation →
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100 text-xs">
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Quotation</span>
            <span className="font-mono font-bold text-gray-900">{approval.quotation_number}</span>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Currency</span>
            <span className="text-sm font-bold text-gray-900">{approval.currency_code}</span>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Grand Total</span>
            <span className="text-sm font-bold text-gray-900">{format(approval.grand_total)}</span>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <span className="text-gray-500 block">Discount Overage</span>
            <span className="text-sm font-bold text-red-600">{Number(approval.total_overage).toFixed(1)} pts</span>
          </div>
        </div>

        {approval.notes && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800">
            <span className="font-semibold">Submission notes:</span> {approval.notes}
          </div>
        )}
      </div>

      {/* Steps timeline */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Approval Chain</h2>
        <ol className="space-y-3">
          {approval.steps.map((step, idx) => (
            <li key={step.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border ${
                  step.status === "APPROVED" ? "bg-green-100 border-green-300 text-green-700"
                  : step.status === "REJECTED" ? "bg-red-100 border-red-300 text-red-700"
                  : step.status === "PENDING" ? "bg-yellow-100 border-yellow-300 text-yellow-700"
                  : "bg-gray-100 border-gray-200 text-gray-500"
                }`}>
                  {step.sequence}
                </div>
                {idx < approval.steps.length - 1 && <div className="w-px h-6 bg-gray-200" />}
              </div>
              <div className="pb-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 text-sm">{step.role_name}</span>
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded ${stepStatusStyles[step.status] || "bg-gray-100 text-gray-700"}`}>
                    {step.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {step.decided_by_name
                    ? `Decided by ${step.decided_by_name} on ${step.decided_at ? new Date(step.decided_at).toLocaleString() : ""}`
                    : "Awaiting decision"}
                  {step.notes ? ` — "${step.notes}"` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {pendingStep && !canDecide && approval.status === "PENDING_APPROVAL" && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Waiting on <strong>{pendingStep.role_name}</strong> to decide this step.
            {userRoleId === null ? " Sign in to take action." : " Only this role can act on the current step."}
          </p>
        )}
      </div>

      {/* Decision actions */}
      {canDecide && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-bold text-gray-900">Your Decision</h2>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional decision notes / comments"
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <button
              disabled={acting}
              onClick={() => decide("return")}
              className="px-4 py-2 border border-purple-300 text-purple-700 bg-white rounded-md text-sm font-medium hover:bg-purple-50 disabled:opacity-50"
            >
              Return to Editing
            </button>
            <button
              disabled={acting}
              onClick={() => decide("reject")}
              className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              Reject Quote
            </button>
            <button
              disabled={acting}
              onClick={() => decide("approve")}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {approval.steps.filter((s) => s.status === "APPROVED").length === approval.steps.length - 1
                ? "Approve & Finalize"
                : "Approve This Step"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}