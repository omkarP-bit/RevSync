"use client";

import { useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface CustomerSetupInfo {
  id: number;
  name: string;
  email: string;
  company?: string;
  setup_token?: string;
  is_password_set?: boolean;
}

interface PortalSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: CustomerSetupInfo | null;
  onCustomerUpdated?: () => void;
}

export function PortalSetupModal({
  isOpen,
  onClose,
  customer,
  onCustomerUpdated,
}: PortalSetupModalProps) {
  const [setupToken, setSetupToken] = useState<string | null>(customer?.setup_token || null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !customer) return null;

  const currentToken = setupToken || customer.setup_token;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const setupUrl = currentToken ? `${baseUrl}/portal/setup?token=${currentToken}` : "";

  const handleCopyLink = async () => {
    if (!setupUrl) return;
    try {
      await navigator.clipboard.writeText(setupUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setError("Failed to copy setup link to clipboard.");
    }
  };

  const handleOpenSetup = () => {
    if (!setupUrl) return;
    window.open(setupUrl, "_blank");
  };

  const handleGenerateToken = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<
        ApiResponse<{
          customer_id: number;
          customer_name: string;
          email: string;
          setup_token: string;
          expires_at: string;
        }>
      >(`/api/v1/customers/${customer.id}/generate-setup-token`, {});
      setSetupToken(res.data.setup_token);
      if (onCustomerUpdated) onCustomerUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to generate setup link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200">
        {/* Header */}
        <div className="flex justify-between items-start pb-4 border-b border-slate-100">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
              Customer Portal Account
            </span>
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight mt-1">
              Portal Account Setup Link
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Send this single-use setup link to the customer to activate their portal password.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 font-bold p-1 text-lg"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Customer Details Box */}
        <div className="mt-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-500 font-medium">Customer:</span>
            <span className="font-bold text-slate-900">{customer.name} {customer.company ? `(${customer.company})` : ""}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 font-medium">Email:</span>
            <span className="font-bold text-slate-900">{customer.email}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500 font-medium">Portal Status:</span>
            <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full ${customer.is_password_set ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {customer.is_password_set ? "Active Password Set" : "Pending Password Setup"}
            </span>
          </div>
        </div>

        {/* Setup Link Section */}
        {setupUrl ? (
          <div className="mt-4 space-y-3">
            <label className="block text-xs font-bold text-slate-700">
              Temporary Portal Setup Link (Single-Use • Expires in 24h)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={setupUrl}
                className="w-full bg-slate-100 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none select-all"
              />
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 font-medium leading-relaxed">
              🔒 <strong>Security Note:</strong> Passwords are never displayed. The customer must access this link to set their own password securely.
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleCopyLink}
                className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5"
              >
                {copied ? (
                  <>
                    <span>✓</span>
                    <span>Copied Link!</span>
                  </>
                ) : (
                  <>
                    <span>📋</span>
                    <span>Copy Setup Link</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleOpenSetup}
                className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs transition-colors"
              >
                Open Setup
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-center space-y-3">
            <p className="text-xs text-slate-600">
              No active setup token currently loaded. Click below to generate a fresh single-use setup link for this customer.
            </p>
            <button
              type="button"
              onClick={handleGenerateToken}
              disabled={loading}
              className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors disabled:opacity-50"
            >
              {loading ? "Generating Link..." : "Generate New Setup Link"}
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end gap-2">
          {setupUrl && (
            <button
              type="button"
              onClick={handleGenerateToken}
              disabled={loading}
              className="mr-auto px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
            >
              {loading ? "Regenerating..." : "Regenerate Link"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
