"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "@/lib/api";

interface CurrencyInfo {
  name: string;
  symbol: string;
  rate: number;
}

interface CurrencyState {
  baseCurrency: string;
  currencies: Record<string, CurrencyInfo>;
  selected: string;
  symbol: string;
  loading: boolean;
  setSelected: (code: string) => void;
  convert: (amount: number) => number;
  format: (amount: number) => string;
}

const STORAGE_KEY = "revsync_display_currency";

const CurrencyContext = createContext<CurrencyState | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currencies, setCurrencies] = useState<Record<string, CurrencyInfo>>({});
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [selected, setSelectedState] = useState<string>("USD");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{
          data: { base_currency: string; currencies: Record<string, CurrencyInfo> };
        }>("/api/v1/currencies/rates");
        setBaseCurrency(res.data.base_currency);
        setCurrencies(res.data.currencies);

        const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        if (stored && res.data.currencies[stored]) {
          setSelectedState(stored);
        } else {
          setSelectedState(res.data.base_currency);
        }
      } catch {
        setCurrencies({ USD: { name: "US Dollar", symbol: "$", rate: 1 } });
        setBaseCurrency("USD");
        setSelectedState("USD");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setSelected = useCallback((code: string) => {
    setSelectedState(code);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, code);
    }
  }, []);

  const rate = currencies[selected]?.rate ?? 1;

  const convert = useCallback(
    (amount: number) => {
      const base = currencies[baseCurrency]?.rate ?? 1;
      const target = currencies[selected]?.rate ?? 1;
      if (!base || !target) return Number(amount) || 0;
      return (Number(amount) / base) * target;
    },
    [baseCurrency, selected, currencies]
  );

  const format = useCallback(
    (amount: number) => {
      const symbol = currencies[selected]?.symbol ?? "$";
      const value = convert(amount);
      const formatted = value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `${symbol} ${formatted}`;
    },
    [convert, currencies, selected]
  );

  return (
    <CurrencyContext.Provider
      value={{
        baseCurrency,
        currencies,
        selected,
        symbol: currencies[selected]?.symbol ?? "$",
        loading,
        setSelected,
        convert,
        format,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyState {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return ctx;
}

export function CurrencySelect() {
  const { currencies, selected, setSelected } = useCurrency();
  return (
    <label className="flex items-center gap-2 text-xs text-gray-500">
      Currency:
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="border border-gray-300 rounded-md px-2 py-1 text-xs font-semibold text-gray-800 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
      >
        {Object.entries(currencies).map(([code, info]) => (
          <option key={code} value={code}>
            {code} ({info.symbol}) — {info.name}
          </option>
        ))}
      </select>
    </label>
  );
}
