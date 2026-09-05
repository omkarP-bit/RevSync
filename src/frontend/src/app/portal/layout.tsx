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
          <Link href="/portal" className="text-xl font-bold text-green-600">RevSync Portal</Link>
          <div className="flex items-center gap-4 text-sm font-medium text-gray-600">
            <Link href="/portal" className="hover:text-green-600">Quotations</Link>
            <Link href="/portal/invoices" className="hover:text-green-600">Invoices</Link>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto p-6">{children}</main>
    </div>
  );
}
