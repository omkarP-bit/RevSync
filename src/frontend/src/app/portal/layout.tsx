"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface CustomerInfo {
  id: number;
  name: string;
  email: string;
  company: string | null;
  status: string;
  currency_code: string;
  tier_name: string;
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);

  const isPublicPage = pathname === "/portal/login" || pathname === "/portal/setup";

  useEffect(() => {
    const token = api.getCustomerToken();
    if (!token && !isPublicPage) {
      router.push("/portal/login");
      return;
    }

    if (token) {
      const stored = localStorage.getItem("customer_info");
      if (stored) {
        try {
          setCustomer(JSON.parse(stored));
        } catch {
          // ignore parsing error
        }
      }
    }

    setReady(true);
  }, [pathname, router, isPublicPage]);

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (!ready) {
    return <div className="flex items-center justify-center min-h-screen text-sm text-gray-500">Loading Portal...</div>;
  }

  const handleLogout = () => {
    api.customerLogout();
    router.push("/portal/login");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-4 py-3 shadow-xs">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center space-x-6">
            <Link href="/portal" className="text-xl font-black text-indigo-600 tracking-tight">
              RevSync <span className="text-xs font-semibold px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full">Portal</span>
            </Link>
            <div className="flex items-center space-x-4 text-xs font-bold text-gray-600">
              <Link
                href="/portal"
                className={`hover:text-indigo-600 transition-colors ${pathname === "/portal" ? "text-indigo-600 font-extrabold" : ""}`}
              >
                Dashboard
              </Link>
              <Link
                href="/portal/quotations"
                className={`hover:text-indigo-600 transition-colors ${pathname.startsWith("/portal/quotations") ? "text-indigo-600 font-extrabold" : ""}`}
              >
                Quotations
              </Link>
              <Link
                href="/portal/invoices"
                className={`hover:text-indigo-600 transition-colors ${pathname.startsWith("/portal/invoices") ? "text-indigo-600 font-extrabold" : ""}`}
              >
                Invoices
              </Link>
              <Link
                href="/portal/subscriptions"
                className={`hover:text-indigo-600 transition-colors ${pathname.startsWith("/portal/subscriptions") ? "text-indigo-600 font-extrabold" : ""}`}
              >
                Subscriptions
              </Link>
              <Link
                href="/portal/wallet"
                className={`hover:text-indigo-600 transition-colors ${pathname.startsWith("/portal/wallet") ? "text-indigo-600 font-extrabold" : ""}`}
              >
                Credit Wallet
              </Link>
              <Link
                href="/portal/profile"
                className={`hover:text-indigo-600 transition-colors ${pathname === "/portal/profile" ? "text-indigo-600 font-extrabold" : ""}`}
              >
                Profile
              </Link>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {customer && (
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-gray-900">{customer.name}</p>
                <p className="text-[10px] text-gray-500 font-medium">{customer.company || customer.email} • {customer.tier_name}</p>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs rounded-lg transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto p-6">{children}</main>
    </div>
  );
}
