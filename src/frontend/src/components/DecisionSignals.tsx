"use client";

import React from "react";

export interface DecisionSignal {
  type: "warning" | "info" | "success";
  text: string;
}

export interface DecisionSignalsProps {
  signals: DecisionSignal[];
}

export const DecisionSignals: React.FC<DecisionSignalsProps> = ({ signals }) => {
  if (!signals || signals.length === 0) return null;

  const formatSignalText = (text: string) => {
    return text.replace(/(\d+\.\d+)/g, (match) => {
      const val = parseFloat(match);
      return Number.isInteger(val) ? val.toString() : parseFloat(val.toFixed(2)).toString();
    });
  };

  return (
    <div className="space-y-2 mb-4">
      <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
        <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span>Active Decision Signals</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {signals.map((sig, idx) => {
          const isWarning = sig.type === "warning";
          const isSuccess = sig.type === "success";

          const badgeStyle = isWarning
            ? "bg-amber-50 text-amber-900 border-amber-200"
            : isSuccess
            ? "bg-emerald-50 text-emerald-900 border-emerald-200"
            : "bg-blue-50 text-blue-900 border-blue-200";

          return (
            <span
              key={idx}
              className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border shadow-2xs transition-colors ${badgeStyle}`}
            >
              {isWarning && (
                <svg className="w-3.5 h-3.5 mr-1.5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
              {isSuccess && (
                <svg className="w-3.5 h-3.5 mr-1.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {!isWarning && !isSuccess && (
                <svg className="w-3.5 h-3.5 mr-1.5 text-blue-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <span>{formatSignalText(sig.text)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};
