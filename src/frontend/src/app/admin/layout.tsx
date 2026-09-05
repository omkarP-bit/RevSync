"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const adminLinks = [
  { label: "Overview", href: "/admin" },
  { label: "Products", href: "/admin/products" },
  { label: "Price Lists", href: "/admin/pricelists" },
  { label: "Customers", href: "/admin/customers" },
  { label: "Categories", href: "/admin/categories" },
  { label: "Currencies", href: "/admin/currencies" },
  { label: "Discount Rules", href: "/admin/discount-rules" },
  { label: "Approval Rules", href: "/admin/approval-rules" },
  { label: "Warehouses", href: "/admin/warehouses" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (!stored) {
      router.push("/login");
      return;
    }
    try {
      const user = JSON.parse(stored);
      // Role ID 1 = Sales Representative -> Block access to Admin Panel
      if (Number(user.role_id) === 1) {
        setAuthorized(false);
        alert("Access Denied: Admin Panel is restricted to Managers, Finance, and System Admins.");
        router.push("/internal");
      } else {
        setAuthorized(true);
      }
    } catch {
      router.push("/login");
    }
  }, [router]);

  if (authorized === null) {
    return <div className="flex items-center justify-center min-h-screen text-slate-500 font-medium">Checking permissions...</div>;
  }

  if (authorized === false) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-6 max-w-7xl mx-auto">
          <Link href="/admin" className="text-xl font-bold text-purple-600">Admin Panel</Link>
          <div className="flex gap-1">
            {adminLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-2 text-sm font-semibold rounded-md transition ${
                  pathname === l.href ? "bg-purple-100 text-purple-700" : "text-gray-600 hover:text-purple-600"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
          <Link href="/internal" className="ml-auto text-sm font-semibold text-gray-500 hover:text-gray-700">
            ← Back to Dashboard
          </Link>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto p-6">{children}</main>
    </div>
  );
}
