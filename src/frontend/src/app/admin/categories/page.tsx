"use client";

import { useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface Category {
  id: number;
  name: string;
  description: string;
  parent_id: number | null;
  created_at: string;
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<ApiResponse<Category[]>>("/api/v1/categories");
        setCategories(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Categories</h1>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm">+ Add Category</button>
      </div>
      {loading ? <p>Loading...</p> : (
        <table className="w-full bg-white rounded-lg shadow">
          <thead>
            <tr className="border-b text-left text-sm text-gray-500">
              <th className="p-3">Name</th>
              <th className="p-3">Description</th>
              <th className="p-3">Parent ID</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className="border-b hover:bg-gray-50">
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3 text-gray-600">{c.description || "—"}</td>
                <td className="p-3 text-gray-600">{c.parent_id ?? "—"}</td>
              </tr>
            ))}
            {categories.length === 0 && (
              <tr><td colSpan={3} className="p-6 text-center text-gray-400">No categories</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
