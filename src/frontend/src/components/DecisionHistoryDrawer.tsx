"use client";

import React, { useEffect, useState, useCallback } from "react";
import { api, ApiResponse } from "@/lib/api";
import { DecisionSignals, DecisionSignal } from "./DecisionSignals";
import { AuditTimeline } from "./AuditTimeline";
import { TimelineItem } from "./AuditEventCard";

export interface DecisionHistoryDrawerProps {
  quotationId: number | string | null;
  isOpen: boolean;
  onClose: () => void;
}

export interface DecisionContext {
  current: {
    grand_total: number;
    discount_total: number;
    order_discount_pct: number;
    margin_pct: number;
    risk_level: string;
    total_overage: number;
    currency_code: string;
    status: string;
    customer_name?: string;
    tier_name?: string;
    payment_terms?: string;
    approval_cycles_count?: number;
    negotiation_rounds_count?: number;
  };
  historical?: {
    original_grand_total?: number;
    original_discount_total?: number;
    original_margin_pct?: number;
    original_risk_level?: string;
  } | null;
}

export const DecisionHistoryDrawer: React.FC<DecisionHistoryDrawerProps> = ({
  quotationId,
  isOpen,
  onClose,
}) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<DecisionContext | null>(null);
  const [signals, setSignals] = useState<DecisionSignal[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [page, setPage] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);

  const fetchTimeline = useCallback(async (p: number = 1) => {
    if (!quotationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ApiResponse<any>>(`/api/v1/quotations/${quotationId}/timeline?page=${p}&limit=50`);
      if (res.data) {
        setContext(res.data.decision_context);
        setSignals(res.data.decision_signals || []);
        setTimeline(res.data.timeline || []);
        if (res.meta) {
          setPage(res.meta.page);
          setTotal(res.meta.total);
          setTotalPages(res.meta.total_pages);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load decision history timeline");
    } finally {
      setLoading(false);
    }
  }, [quotationId]);

  useEffect(() => {
    if (isOpen && quotationId) {
      fetchTimeline(1);
    }
  }, [isOpen, quotationId, fetchTimeline]);

  if (!isOpen) return null;

  const curr = context?.current?.currency_code || "USD";
  const formatCurrency = (val?: number) =>
    val !== undefined && val !== null
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: curr }).format(val)
      : "—";

  const getStatusBadge = (status?: string) => {
    if (!status) return null;
    let style = "bg-slate-100 text-slate-700 border-slate-300";
    if (status === "CONFIRMED") style = "bg-emerald-50 text-emerald-800 border-emerald-300 font-bold";
    else if (status === "APPROVED") style = "bg-blue-50 text-blue-800 border-blue-300 font-bold";
    else if (status.includes("APPROVAL")) style = "bg-amber-50 text-amber-800 border-amber-300 font-bold";
    else if (status === "CANCELLED" || status === "REJECTED") style = "bg-rose-50 text-rose-800 border-rose-300 font-bold";

    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs border ${style}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-sm flex justify-end transition-all">
      <div className="w-full max-w-2xl bg-white border-l border-slate-200 h-full flex flex-col shadow-2xl text-slate-900">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center space-x-2.5">
              <div className="p-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-600">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <span className="text-lg font-bold text-slate-900 tracking-tight">Decision History</span>
              {getStatusBadge(context?.current?.status)}
            </div>
            <p className="text-xs text-slate-500 pl-8">
              Quotation #{quotationId} {context?.current?.customer_name ? `• ${context.current.customer_name}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
            title="Close drawer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Drawer Body Scroll */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 bg-white">
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center space-x-2">
              <svg className="w-4 h-4 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Decision Context Bar */}
          {context?.current && (
            <div className="bg-slate-50/90 border border-slate-200 rounded-2xl p-4 space-y-3 shadow-2xs">
              <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <svg className="w-3.5 h-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                <span>Decision Context</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs space-y-1">
                  <span className="text-[10px] text-slate-500 block font-medium">Grand Total</span>
                  <span className="font-bold text-slate-900 text-sm block">{formatCurrency(context.current.grand_total)}</span>
                  {context.historical?.original_grand_total !== undefined && (
                    <span className="block text-[10px] text-slate-400 font-normal">
                      Orig: {formatCurrency(context.historical.original_grand_total)}
                    </span>
                  )}
                </div>

                <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs space-y-1">
                  <span className="text-[10px] text-slate-500 block font-medium">Margin %</span>
                  <span className="font-bold text-emerald-600 text-sm block">{context.current.margin_pct}%</span>
                  {context.historical?.original_margin_pct !== undefined ? (
                    <span className="block text-[10px] text-slate-400 font-normal">
                      Orig: {context.historical.original_margin_pct}%
                    </span>
                  ) : (
                    <span className="block text-[10px] text-slate-400 font-normal">Orig: Not available</span>
                  )}
                </div>

                <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs space-y-1">
                  <span className="text-[10px] text-slate-500 block font-medium">Discount Risk</span>
                  <span className={`font-bold text-sm block ${context.current.risk_level === "HIGH" ? "text-rose-600" : context.current.risk_level === "MEDIUM" ? "text-amber-600" : "text-emerald-600"}`}>
                    {context.current.risk_level}
                  </span>
                  <span className="block text-[10px] text-slate-400 font-normal">Overage: {context.current.total_overage}%</span>
                </div>

                <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs space-y-1">
                  <span className="text-[10px] text-slate-500 block font-medium">Tier & Terms</span>
                  <span className="font-bold text-blue-600 text-sm block">{context.current.tier_name || "Standard"}</span>
                  <span className="block text-[10px] text-slate-400 font-normal">{context.current.payment_terms || "N/A"}</span>
                </div>
              </div>
            </div>
          )}

          {/* Decision Signals */}
          <DecisionSignals signals={signals} />

          {/* Chronological Audit Timeline */}
          <div className="space-y-3">
            <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              <svg className="w-3.5 h-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Chronological Decision Timeline</span>
            </div>
            <AuditTimeline
              items={timeline}
              page={page}
              total={total}
              totalPages={totalPages}
              onPageChange={(p) => fetchTimeline(p)}
              isLoading={loading}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
