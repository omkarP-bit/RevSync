"use client";

export default function InternalDashboard() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Sales Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500">Pending Approvals</h3>
          <p className="text-3xl font-bold text-yellow-600 mt-2">—</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500">Open Quotations</h3>
          <p className="text-3xl font-bold text-blue-600 mt-2">—</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500">At-Risk Deals</h3>
          <p className="text-3xl font-bold text-red-600 mt-2">—</p>
        </div>
      </div>
    </div>
  );
}
