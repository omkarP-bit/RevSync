"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiResponse } from "@/lib/api";

interface CustomerProfile {
  id: number;
  name: string;
  email: string;
  company: string | null;
  status: string;
  currency_code: string;
  payment_terms: string;
  credit_limit: number;
  billing_address: string | null;
  shipping_address: string | null;
  tier_name: string;
}

export default function CustomerProfilePage() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async () => {
    try {
      const res = await api.get<ApiResponse<{ customer: CustomerProfile }>>("/api/v1/portal/dashboard");
      setProfile(res.data.customer);
    } catch (err: any) {
      setError(err.message || "Failed to load customer profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  if (loading) {
    return <div className="p-12 text-center text-sm text-gray-500">Loading profile information...</div>;
  }

  if (error || !profile) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold">
        {error || "Failed to load profile."}
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 max-w-4xl mx-auto">
      <div className="pb-2 border-b border-gray-200">
        <h1 className="text-2xl font-black text-gray-900 tracking-tight">Customer Profile</h1>
        <p className="text-xs text-gray-500">Account overview and commercial tier settings.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6 space-y-6">
        {/* Header Profile Summary */}
        <div className="flex items-center space-x-4 border-b border-gray-100 pb-6">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-xl">
            {profile.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{profile.name}</h2>
            <p className="text-xs text-gray-500">{profile.company ? `${profile.company} • ` : ""}{profile.email}</p>
            <div className="flex items-center space-x-2 mt-2">
              <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 text-[11px] font-black rounded-full uppercase">
                {profile.tier_name} Tier
              </span>
              <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-black rounded-full uppercase">
                {profile.status}
              </span>
            </div>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Account Details</h3>

            <div>
              <label className="text-[11px] font-semibold text-gray-500">Contact Email</label>
              <p className="text-sm font-medium text-gray-900">{profile.email}</p>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-gray-500">Company Name</label>
              <p className="text-sm font-medium text-gray-900">{profile.company || "Individual Account"}</p>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-gray-500">Account Status</label>
              <p className="text-sm font-bold text-emerald-600">{profile.status}</p>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Commercial Terms</h3>

            <div>
              <label className="text-[11px] font-semibold text-gray-500">Billing Currency</label>
              <p className="text-sm font-extrabold text-indigo-600">{profile.currency_code}</p>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-gray-500">Approved Payment Terms</label>
              <p className="text-sm font-medium text-gray-900">{profile.payment_terms}</p>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-gray-500">Credit Limit</label>
              <p className="text-sm font-extrabold text-gray-900">
                {profile.currency_code} {Number(profile.credit_limit).toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* Address Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-gray-100">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h4 className="text-xs font-bold text-gray-700 mb-2">Billing Address</h4>
            <p className="text-xs text-gray-600 whitespace-pre-wrap">
              {profile.billing_address || "No billing address specified."}
            </p>
          </div>

          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h4 className="text-xs font-bold text-gray-700 mb-2">Shipping Address</h4>
            <p className="text-xs text-gray-600 whitespace-pre-wrap">
              {profile.shipping_address || "No shipping address specified."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
