"use client";

import React, { useState } from "react";
import { AuditEventCard, TimelineItem } from "./AuditEventCard";

export interface AuditTimelineProps {
  items: TimelineItem[];
  page: number;
  total: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  isLoading?: boolean;
}

const CATEGORIES = ["All", "Pricing", "Line Items", "Approvals", "Negotiations", "Fulfillment", "Billing", "Status"] as const;

export const AuditTimeline: React.FC<AuditTimelineProps> = ({
  items,
  page,
  total,
  totalPages,
  onPageChange,
  isLoading = false,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const filteredItems = selectedCategory === "All"
    ? items
    : items.filter((item) => item.category === selectedCategory);

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-slate-100/90 border border-slate-200/90 rounded-xl">
        {CATEGORIES.map((cat) => {
          const isActive = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? "bg-blue-600 text-white shadow-xs font-semibold"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/70"
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Timeline Stream */}
      {isLoading ? (
        <div className="p-10 text-center text-slate-500 text-xs flex items-center justify-center space-x-2">
          <svg className="w-4 h-4 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Loading Decision History...</span>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-500 text-xs flex flex-col items-center justify-center space-y-2">
          <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>No decision events recorded under &quot;{selectedCategory}&quot;.</span>
        </div>
      ) : (
        <div className="pt-2">
          {filteredItems.map((item) => (
            <AuditEventCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-200 text-xs text-slate-500">
          <span>
            Page <strong className="text-slate-900 font-semibold">{page}</strong> of <strong className="text-slate-900 font-semibold">{totalPages}</strong> ({total} total events)
          </span>
          <div className="flex space-x-2">
            <button
              disabled={page <= 1 || isLoading}
              onClick={() => onPageChange(page - 1)}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 shadow-2xs hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-medium transition-colors"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages || isLoading}
              onClick={() => onPageChange(page + 1)}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 shadow-2xs hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-medium transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
