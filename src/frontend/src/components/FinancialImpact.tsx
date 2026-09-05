"use client";

import React from "react";

export interface FinancialImpactProps {
  before?: {
    grand_total?: number;
    discount_total?: number;
    order_discount_pct?: number;
    margin_pct?: number;
    risk_level?: string;
    currency_code?: string;
  } | null;
  after?: {
    grand_total?: number;
    discount_total?: number;
    order_discount_pct?: number;
    margin_pct?: number;
    risk_level?: string;
    currency_code?: string;
  } | null;
}

export const FinancialImpact: React.FC<FinancialImpactProps> = ({ before, after }) => {
  if (!before && !after) return null;

  const curr = after?.currency_code || before?.currency_code || "USD";

  const formatCurrency = (val?: number) =>
    val !== undefined && val !== null
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: curr }).format(val)
      : "—";

  const formatPct = (val?: number) => (val !== undefined && val !== null ? `${val}%` : "—");

  return (
    <div className="mt-3 p-3.5 bg-slate-50 border border-slate-200/90 rounded-xl text-xs space-y-2.5">
      <div className="flex items-center space-x-1.5 text-slate-500 font-semibold text-[11px] uppercase tracking-wider">
        <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span>Financial & Risk Impact</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {/* Grand Total */}
        {(before?.grand_total !== undefined || after?.grand_total !== undefined) && (
          <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
            <span className="text-slate-500 block text-[10px] font-medium">Grand Total</span>
            <div className="flex items-center space-x-1.5 font-semibold text-slate-900">
              <span className="line-through text-slate-400 font-normal">{formatCurrency(before?.grand_total)}</span>
              <span className="text-slate-400">→</span>
              <span className={after?.grand_total && before?.grand_total && after.grand_total < before.grand_total ? "text-amber-700 font-bold" : "text-emerald-700 font-bold"}>
                {formatCurrency(after?.grand_total)}
              </span>
            </div>
          </div>
        )}

        {/* Margin % */}
        {(before?.margin_pct !== undefined || after?.margin_pct !== undefined) && (
          <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
            <span className="text-slate-500 block text-[10px] font-medium">Margin %</span>
            <div className="flex items-center space-x-1.5 font-semibold">
              <span className="line-through text-slate-400 font-normal">{formatPct(before?.margin_pct)}</span>
              <span className="text-slate-400">→</span>
              <span className={after?.margin_pct && before?.margin_pct && after.margin_pct < before.margin_pct ? "text-rose-700 font-bold" : "text-emerald-700 font-bold"}>
                {formatPct(after?.margin_pct)}
              </span>
            </div>
          </div>
        )}

        {/* Order Discount % */}
        {(before?.order_discount_pct !== undefined || after?.order_discount_pct !== undefined) && (
          <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
            <span className="text-slate-500 block text-[10px] font-medium">Order Discount</span>
            <div className="flex items-center space-x-1.5 font-semibold">
              <span className="line-through text-slate-400 font-normal">{formatPct(before?.order_discount_pct)}</span>
              <span className="text-slate-400">→</span>
              <span className="text-indigo-700 font-bold">{formatPct(after?.order_discount_pct)}</span>
            </div>
          </div>
        )}

        {/* Risk Level */}
        {(before?.risk_level || after?.risk_level) && (
          <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
            <span className="text-slate-500 block text-[10px] font-medium">Risk Level</span>
            <div className="flex items-center space-x-1.5 font-semibold">
              <span className="line-through text-slate-400 font-normal">{before?.risk_level || "—"}</span>
              <span className="text-slate-400">→</span>
              <span className={after?.risk_level === "HIGH" ? "text-rose-700 font-bold" : after?.risk_level === "MEDIUM" ? "text-amber-700 font-bold" : "text-emerald-700 font-bold"}>
                {after?.risk_level || "—"}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
