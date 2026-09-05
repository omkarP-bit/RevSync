"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const adminLinks = [
  { label: "Overview", href: "/admin" },
  { label: "Customers", href: "/admin/customers" },
  { label: "Categories", href: "/admin/categories" },
  { label: "Currencies", href: "/admin/currencies" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-6 max-w-7xl mx-auto">
          <Link href="/admin" className="text-xl font-bold text-purple-600">Admin</Link>
          <div className="flex gap-1">
            {adminLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-2 text-sm rounded-md ${pathname === l.href ? "bg-purple-100 text-purple-700" : "text-gray-600 hover:text-purple-600"}`}
              >
                {l.label}
              </Link>
            ))}
          </div>
          <Link href="/internal" className="ml-auto text-sm text-gray-500 hover:text-gray-700">← Back to Internal</Link>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto p-6">{children}</main>
    </div>
  );
}
