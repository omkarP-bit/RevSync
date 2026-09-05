"use client";

import React from "react";
import { FinancialImpact } from "./FinancialImpact";

export interface TimelineItem {
  id: string;
  timestamp: string;
  action: string;
  category: "Pricing" | "Line Items" | "Approvals" | "Negotiations" | "Fulfillment" | "Billing" | "Status";
  title: string;
  description: string;
  reason: string | null;
  actor: { name: string; role: string } | null;
  before: any;
  after: any;
  financial_impact: { before: any; after: any } | null;
}

export interface AuditEventCardProps {
  item: TimelineItem;
}

export const AuditEventCard: React.FC<AuditEventCardProps> = ({ item }) => {
  const formattedDate = new Date(item.timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case "Pricing":
        return "bg-indigo-50 text-indigo-800 border-indigo-200 font-semibold";
      case "Line Items":
        return "bg-cyan-50 text-cyan-800 border-cyan-200 font-semibold";
      case "Approvals":
        return "bg-purple-50 text-purple-800 border-purple-200 font-semibold";
      case "Negotiations":
        return "bg-amber-50 text-amber-800 border-amber-200 font-semibold";
      case "Fulfillment":
        return "bg-teal-50 text-teal-800 border-teal-200 font-semibold";
      case "Billing":
        return "bg-emerald-50 text-emerald-800 border-emerald-200 font-semibold";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200 font-semibold";
    }
  };

  const lineBefore = item.before?.line;
  const lineAfter = item.after?.line;

  return (
    <div className="relative pl-6 pb-6 border-l-2 border-slate-200 last:pb-0 group">
      {/* Timeline Node Dot */}
      <div className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-blue-600 border-2 border-white ring-4 ring-blue-500/15 group-hover:scale-125 transition-transform" />

      <div className="bg-white border border-slate-200/90 hover:border-slate-300 transition-all rounded-2xl p-4 shadow-2xs space-y-3 text-slate-800">
        {/* Header: Title, Category Badge, Timestamp */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-900 text-sm">{item.title}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] border ${getCategoryColor(item.category)}`}>
              {item.category}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">{formattedDate}</span>
        </div>

        {/* Actor Info */}
        <div className="text-xs text-slate-600 flex items-center space-x-2">
          <span className="w-5 h-5 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-700 shadow-2xs">
            {item.actor ? item.actor.name.charAt(0).toUpperCase() : "S"}
          </span>
          <span>
            <strong className="text-slate-800 font-semibold">{item.actor ? item.actor.name : "System"}</strong>
            {item.actor?.role ? ` (${item.actor.role})` : ""}
          </span>
        </div>

        {/* User Reason / Note if available */}
        {item.reason && (
          <div className="text-xs bg-slate-50 p-3 rounded-xl border border-slate-200 border-l-3 border-l-blue-600 text-slate-700 space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Reason / Note</span>
            <p className="italic text-slate-700">&quot;{item.reason}&quot;</p>
          </div>
        )}

        {/* Line Item Snapshot Diffs if available */}
        {(lineBefore || lineAfter) && (
          <div className="mt-2 text-xs bg-slate-50/90 p-3 rounded-xl border border-slate-200 space-y-1.5">
            <div className="flex items-center space-x-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              <svg className="w-3.5 h-3.5 text-cyan-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span>Product Line Detail</span>
            </div>
            {lineAfter?.product_name && (
              <div className="text-slate-900 font-semibold">{lineAfter.product_name} {lineAfter.product_sku ? `(${lineAfter.product_sku})` : ""}</div>
            )}
            {lineBefore?.product_name && !lineAfter?.product_name && (
              <div className="text-rose-600 font-semibold line-through">{lineBefore.product_name} {lineBefore.product_sku ? `(${lineBefore.product_sku})` : ""}</div>
            )}
            <div className="grid grid-cols-2 gap-x-4 text-[11px] text-slate-600">
              {lineBefore?.quantity !== lineAfter?.quantity && (
                <div>Quantity: <span className="line-through text-slate-400">{lineBefore?.quantity ?? 0}</span> → <span className="text-emerald-700 font-semibold">{lineAfter?.quantity ?? 0}</span></div>
              )}
              {lineBefore?.unit_price !== lineAfter?.unit_price && (
                <div>Unit Price: <span className="line-through text-slate-400">${lineBefore?.unit_price ?? 0}</span> → <span className="text-emerald-700 font-semibold">${lineAfter?.unit_price ?? 0}</span></div>
              )}
              {lineBefore?.applied_discount_pct !== lineAfter?.applied_discount_pct && (
                <div>Discount: <span className="line-through text-slate-400">{lineBefore?.applied_discount_pct ?? 0}%</span> → <span className="text-indigo-700 font-semibold">{lineAfter?.applied_discount_pct ?? 0}%</span></div>
              )}
              {lineBefore?.line_margin !== lineAfter?.line_margin && lineAfter?.line_margin !== undefined && (
                <div>Line Margin: <span className="text-slate-800 font-semibold">${lineAfter.line_margin}</span></div>
              )}
            </div>
          </div>
        )}

        {/* Financial Impact Component */}
        {item.financial_impact && (
          <FinancialImpact
            before={item.financial_impact.before}
            after={item.financial_impact.after}
          />
        )}
      </div>
    </div>
  );
};
