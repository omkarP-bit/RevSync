"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

const navItems = [
  { label: "Dashboard", href: "/internal" },
  { label: "Quotations", href: "/internal/quotations" },
  { label: "Approvals", href: "/internal/approvals" },
  { label: "Fulfillment", href: "/internal/fulfillment" },
  { label: "Subscriptions", href: "/internal/subscriptions" },
  { label: "Invoices", href: "/internal/invoices" },
  { label: "Deal Health", href: "/internal/deal-health" },
  { label: "Reports", href: "/internal/reports" },
  { label: "Admin", href: "/admin" },
];

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<{ email: string; role_name: string } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (!stored) {
      router.push("/login");
      return;
    }
    setUser(JSON.parse(stored));
  }, [router]);

  if (!user) return <div className="flex items-center justify-center min-h-screen">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-6">
            <Link href="/internal" className="text-xl font-bold text-blue-600">
              DealFlow360
            </Link>
            <div className="hidden md:flex gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-2 text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{user.email}</span>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">{user.role_name}</span>
            <button
              onClick={() => {
                localStorage.clear();
                router.push("/login");
              }}
              className="text-sm text-red-600 hover:text-red-800"
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
