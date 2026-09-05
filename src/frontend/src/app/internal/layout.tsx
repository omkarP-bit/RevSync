"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CurrencyProvider, CurrencySelect } from "@/components/CurrencyProvider";

interface User {
  id: number;
  email: string;
  role_id: number;
  role_name: string;
}

const navItems: { label: string; href: string; adminOnly?: boolean; roles?: number[] }[] = [
  { label: "Dashboard", href: "/internal", adminOnly: false },
  { label: "Quotations", href: "/internal/quotations", adminOnly: false },
  { label: "Approvals", href: "/internal/approvals", adminOnly: false },
  { label: "Negotiations", href: "/internal/negotiations", adminOnly: false },
  { label: "Fulfillment", href: "/internal/fulfillment", adminOnly: false },
  { label: "Subscriptions", href: "/internal/subscriptions", adminOnly: false },
  { label: "Invoices", href: "/internal/invoices", adminOnly: false },
  { label: "Deal Health", href: "/internal/deal-health", roles: [2, 3, 5] },
  { label: "Reports", href: "/internal/reports", adminOnly: false },
  { label: "Admin", href: "/admin", adminOnly: true },
];

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (!stored) {
      router.push("/login");
      return;
    }
    setUser(JSON.parse(stored));
  }, [router]);

  if (!user) return <div className="flex items-center justify-center min-h-screen">Loading...</div>;

  // Allowed roles for Admin panel: Sales Manager (2), Finance (3), Warehouse Manager (4), Admin (5)
  // Sales Representative (Role 1) is blocked from accessing Admin
  const canAccessAdmin = Number(user.role_id) !== 1;

  const filteredNavItems = navItems.filter(
    (item) =>
      (!item.adminOnly || canAccessAdmin) && (!item.roles || item.roles.includes(Number(user.role_id)))
  );

  return (
    <CurrencyProvider>
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="flex items-center justify-between max-w-[1800px] mx-auto">
            <div className="flex items-center gap-6">
              <Link href="/internal" className="text-xl font-bold text-blue-600">
                RevSync
              </Link>
              <div className="hidden md:flex gap-1">
                {filteredNavItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <CurrencySelect />
              <span className="text-sm text-gray-500">{user.email}</span>
              <span className="text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded font-semibold">{user.role_name}</span>
              <button
                onClick={() => {
                  localStorage.clear();
                  router.push("/login");
                }}
                className="text-sm font-medium text-red-600 hover:text-red-800"
              >
                Logout
              </button>
            </div>
          </div>
        </nav>
        <main className="max-w-[1800px] mx-auto p-4 sm:p-6 w-full">{children}</main>
      </div>
    </CurrencyProvider>
  );
}
