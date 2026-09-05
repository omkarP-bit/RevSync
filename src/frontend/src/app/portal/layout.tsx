"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) return <div className="flex items-center justify-center min-h-screen">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center space-x-6">
            <Link href="/portal" className="text-xl font-bold text-indigo-600">RevSync Customer Portal</Link>
            <div className="flex items-center space-x-4 text-sm font-semibold">
              <Link href="/portal" className="text-gray-600 hover:text-indigo-600">Quotations</Link>
              <Link href="/portal/invoices" className="text-gray-600 hover:text-indigo-600">Invoices</Link>
              <Link href="/portal/subscriptions" className="text-gray-600 hover:text-indigo-600">Subscriptions</Link>
              <Link href="/portal/wallet" className="text-gray-600 hover:text-indigo-600">Credit Wallet</Link>
            </div>
          </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto p-6">{children}</main>
    </div>
  );
}
