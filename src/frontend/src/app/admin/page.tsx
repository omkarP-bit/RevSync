import Link from "next/link";

export default function AdminPage() {
  const sections = [
    { label: "Customers", href: "/admin/customers", description: "Manage customer accounts and tiers" },
    { label: "Categories", href: "/admin/categories", description: "Product categories" },
    { label: "Currencies", href: "/admin/currencies", description: "Currency codes and exchange rates" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Admin Console</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="bg-white rounded-lg shadow p-6 hover:shadow-md transition">
            <h3 className="font-semibold text-lg">{s.label}</h3>
            <p className="text-sm text-gray-500 mt-1">{s.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
