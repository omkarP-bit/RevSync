"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiResponse } from "@/lib/api";
import { CustomerFormModal, Customer as ModalCustomer } from "@/components/CustomerFormModal";
import { exportQuotationPdf } from "@/lib/pdf";
import { useCurrency } from "@/components/CurrencyProvider";

interface QuotationLine {
  id: number;
  quotation_id: number;
  product_id: number;
  product_name: string;
  product_sku: string;
  category_id?: number;
  product_type?: "ONE_TIME" | "RECURRING";
  product_variant_id?: number | null;
  variant_name?: string | null;
  description?: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  applied_discount_pct: number;
  discount_amount: number;
  line_subtotal: number;
  line_total: number;
  line_cost: number;
  line_margin: number;
}

interface DiscountAnalysisLine {
  id: number | null;
  product_id: number;
  product_name: string | null;
  category_id: number;
  applied_discount_pct: number;
  allowed_discount_pct: number;
  line_overage: number;
  is_flagged: boolean;
  reason: string | null;
}

interface DiscountAnalysis {
  lines: DiscountAnalysisLine[];
  order_discount_pct: number;
  order_overage: number;
  total_allowed_discount_amount: number;
  total_applied_discount_amount: number;
  total_overage: number;
}

interface QuotationDetail {
  id: number;
  quotation_number: string;
  public_id: string;
  customer_id: number;
  customer_name: string;
  customer_tier_id: number;
  tier_name: string;
  sales_rep_id: number;
  sales_rep_name: string;
  currency_code: string;
  status: string;
  subtotal: number;
  line_discount_total?: number;
  order_discount_pct: number;
  order_discount_amount: number;
  discount_total: number;
  tax_rate_pct: number;
  tax_total: number;
  grand_total: number;
  total_cost: number;
  margin_amount: number;
  margin_pct: number;
  risk_level: string;
  total_overage: number;
  notes?: string;
  discount_analysis?: DiscountAnalysis;
  lines: QuotationLine[];
}

interface Product {
  id: number;
  name: string;
  sku: string;
  category_id: number;
  category_name?: string;
  product_type?: "ONE_TIME" | "RECURRING";
  variants_count?: number;
}

interface ProductVariant {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  attributes: Record<string, any>;
}

interface Category {
  id: number;
  name: string;
}

interface Customer {
  id: number;
  name: string;
  company?: string;
  tier_name?: string;
  currency_code: string;
}

interface ProductRelationship {
  id: number;
  product_id: number;
  related_product_id: number;
  related_product_name: string;
  related_product_sku: string;
  relationship_type: "UPSELL" | "CROSS_SELL";
}

interface ApprovalStep {
  id: number;
  sequence: number;
  role_id: number;
  role_name?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decided_by?: number;
  decided_at?: string;
}

interface ApprovalRequest {
  id: number;
  quotation_id: number;
  status: string;
  risk_level: string;
  total_overage: number;
  notes?: string;
  created_at: string;
  steps: ApprovalStep[];
}

interface AuthUser {
  id: number;
  email: string;
  role_id: number;
  role_name: string;
}

export default function QuotationDetailBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const quoteId = params?.id as string;

  const [quote, setQuote] = useState<QuotationDetail | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  // Toast Notification State
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Debounced line edit state
  const [updatingLineId, setUpdatingLineId] = useState<number | null>(null);
  const updateDebounceTimers = useRef<Record<number, NodeJS.Timeout>>({});

  // Customer Creation Modal State
  const [showCreateCustomerModal, setShowCreateCustomerModal] = useState(false);

  // Add Line Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<number>(0);
  const [productVariants, setProductVariants] = useState<ProductVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [lineQty, setLineQty] = useState<number>(1);
  const [lineDiscount, setLineDiscount] = useState<number>(0);

  // Recommendations & Approval Chain State
  const [recommendations, setRecommendations] = useState<ProductRelationship[]>([]);
  const [dismissedRecIds, setDismissedRecIds] = useState<number[]>([]);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);

  // Cancel Modal State
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { format } = useCurrency();

  useEffect(() => {
    try {
      const uStr = localStorage.getItem("user");
      if (uStr) {
        setCurrentUser(JSON.parse(uStr));
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchQuote = async () => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}`);
      setQuote(res.data);
      fetchApprovalDetail(res.data.id);
      fetchRecommendations(res.data.lines);
    } catch (err: any) {
      setError(err.message || "Failed to load quotation detail");
    } finally {
      setLoading(false);
    }
  };

  const fetchCustomers = async () => {
    try {
      const res = await api.get<ApiResponse<Customer[]>>("/api/v1/customers", { limit: "100" });
      setCustomers(res.data);
    } catch {
      // ignore
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.get<ApiResponse<Category[]>>("/api/v1/categories");
      setCategories(res.data);
    } catch {
      // ignore
    }
  };

  const fetchProducts = async (catId: number = 0, search: string = "") => {
    try {
      const queryParams: Record<string, string> = { limit: "100" };
      if (catId > 0) queryParams.category_id = catId.toString();
      if (search.trim()) queryParams.search = search.trim();

      const res = await api.get<ApiResponse<Product[]>>("/api/v1/products", queryParams);
      setAvailableProducts(res.data);

      if (res.data.length > 0) {
        setSelectedProductId(res.data[0].id);
        fetchVariantsForProduct(res.data[0].id);
      } else {
        setSelectedProductId(0);
        setProductVariants([]);
        setSelectedVariantId(null);
      }
    } catch {
      // ignore
    }
  };

  const fetchVariantsForProduct = async (productId: number) => {
    if (!productId) {
      setProductVariants([]);
      setSelectedVariantId(null);
      return;
    }
    setLoadingVariants(true);
    try {
      const res = await api.get<ApiResponse<ProductVariant[]>>(`/api/v1/products/${productId}/variants`);
      setProductVariants(res.data);
      if (res.data.length > 0) {
        setSelectedVariantId(res.data[0].id);
      } else {
        setSelectedVariantId(null);
      }
    } catch {
      setProductVariants([]);
      setSelectedVariantId(null);
    } finally {
      setLoadingVariants(false);
    }
  };

  const fetchRecommendations = async (lines: QuotationLine[]) => {
    if (!lines || lines.length === 0) {
      setRecommendations([]);
      return;
    }
    try {
      const distinctProductIds = Array.from(new Set(lines.map((l) => l.product_id)));
      const relPromises = distinctProductIds.map((pId) =>
        api.get<ApiResponse<ProductRelationship[]>>(`/api/v1/products/${pId}/relationships`).catch(() => ({ data: [] }))
      );

      const results = await Promise.all(relPromises);
      const allRels: ProductRelationship[] = [];
      results.forEach((res) => {
        if (res.data) allRels.push(...res.data);
      });

      const existingProductIds = new Set(lines.map((l) => l.product_id));
      const filtered = allRels.filter((r) => !existingProductIds.has(r.related_product_id));

      const uniqueMap = new Map<number, ProductRelationship>();
      filtered.forEach((r) => {
        if (!uniqueMap.has(r.related_product_id)) uniqueMap.set(r.related_product_id, r);
      });

      setRecommendations(Array.from(uniqueMap.values()));
    } catch {
      setRecommendations([]);
    }
  };

  const fetchApprovalDetail = async (qId: number) => {
    try {
      const res = await api.get<ApiResponse<ApprovalRequest[]>>("/api/v1/approvals", { quotation_id: qId.toString() });
      if (res.data && res.data.length > 0) {
        const detail = await api.get<ApiResponse<ApprovalRequest>>(`/api/v1/approvals/${res.data[0].id}`);
        setApprovalRequest(detail.data);
      } else {
        setApprovalRequest(null);
      }
    } catch {
      setApprovalRequest(null);
    }
  };

  useEffect(() => {
    if (quoteId) {
      fetchQuote();
      fetchCustomers();
      fetchCategories();
    }
  }, [quoteId]);

  const isLocked = quote?.status === "CONFIRMED" || quote?.status === "CANCELLED";
  const activePendingStep = approvalRequest?.steps?.find((s) => s.status === "PENDING");
  const isAuthorizedApprover =
    currentUser &&
    activePendingStep &&
    (currentUser.role_id === activePendingStep.role_id || currentUser.role_id === 5);

  const handleCustomerChange = async (newCustomerId: number) => {
    if (isLocked) return;
    try {
      const res = await api.patch<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}`, {
        customer_id: newCustomerId,
      });
      setQuote(res.data);
      fetchRecommendations(res.data.lines);
      showToast("Customer updated & quotation recalculated", "success");
    } catch (err: any) {
      showToast(err.message || "Failed to update customer", "error");
    }
  };

  const handleCustomerCreated = async (newCustomer: ModalCustomer) => {
    showToast(`Customer ${newCustomer.name} created! Attaching to quotation...`, "success");
    await fetchCustomers();
    handleCustomerChange(newCustomer.id);
  };

  const handleTaxRateChange = async (newTaxRate: number) => {
    if (isLocked) return;
    try {
      const res = await api.patch<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}`, {
        tax_rate_pct: newTaxRate,
      });
      setQuote(res.data);
      showToast("Tax rate updated", "success");
    } catch (err: any) {
      showToast(err.message || "Failed to update tax rate", "error");
    }
  };

  const handleOrderDiscountChange = async (newOrderDiscount: number) => {
    if (isLocked) return;
    try {
      const res = await api.patch<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}`, {
        order_discount_pct: newOrderDiscount,
      });
      setQuote(res.data);
      fetchApprovalDetail(res.data.id);
      showToast("Order discount updated", "success");
    } catch (err: any) {
      showToast(err.message || "Failed to update order discount", "error");
    }
  };

  const handleNotesChange = async (newNotes: string) => {
    if (isLocked) return;
    try {
      const res = await api.patch<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}`, {
        notes: newNotes,
      });
      setQuote(res.data);
      showToast("Deal notes saved", "success");
    } catch (err: any) {
      showToast(err.message || "Failed to update notes", "error");
    }
  };

  const handleAddLineItem = async (
    productId: number,
    variantId: number | null = null,
    qty: number = 1,
    disc: number = 0
  ) => {
    if (isLocked) return;
    try {
      const res = await api.post<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}/lines`, {
        product_id: productId,
        product_variant_id: variantId,
        quantity: qty,
        applied_discount_pct: disc,
      });

      setQuote(res.data);
      fetchRecommendations(res.data.lines);
      fetchApprovalDetail(res.data.id);
      setShowAddModal(false);
      setLineQty(1);
      setLineDiscount(0);
      showToast("Line item added", "success");
    } catch (err: any) {
      showToast(err.message || "Failed to add line item", "error");
    }
  };

  const handleLineInputChange = (lineId: number, newQty: number, newDisc: number) => {
    if (!quote || isLocked) return;

    setQuote({
      ...quote,
      lines: quote.lines.map((l) =>
        l.id === lineId ? { ...l, quantity: newQty, applied_discount_pct: newDisc } : l
      ),
    });

    if (updateDebounceTimers.current[lineId]) {
      clearTimeout(updateDebounceTimers.current[lineId]);
    }

    updateDebounceTimers.current[lineId] = setTimeout(async () => {
      setUpdatingLineId(lineId);
      try {
        const res = await api.patch<ApiResponse<QuotationDetail>>(
          `/api/v1/quotations/${quoteId}/lines/${lineId}`,
          { quantity: newQty, applied_discount_pct: newDisc }
        );
        setQuote(res.data);
        fetchApprovalDetail(res.data.id);
      } catch (err: any) {
        showToast(err.message || "Failed to update line", "error");
        fetchQuote();
      } finally {
        setUpdatingLineId(null);
      }
    }, 400);
  };

  const handleDeleteLine = async (lineId: number) => {
    if (isLocked) return;
    if (!confirm("Are you sure you want to remove this line item?")) return;
    try {
      const res = await api.request<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}/lines/${lineId}`, {
        method: "DELETE",
      });
      setQuote(res.data);
      fetchRecommendations(res.data.lines);
      fetchApprovalDetail(res.data.id);
      showToast("Line item removed", "info");
    } catch (err: any) {
      showToast(err.message || "Failed to delete line item", "error");
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      const res = await api.patch<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}`, {
        status: newStatus,
      });
      setQuote(res.data);
      fetchApprovalDetail(res.data.id);
      showToast(`Quotation status updated to ${newStatus}`, "success");
    } catch (err: any) {
      showToast(err.message || "Failed to update quotation status", "error");
    }
  };

  const handleSubmitApproval = async () => {
    try {
      const res = await api.post<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}/submit`, {});
      setQuote(res.data);
      fetchApprovalDetail(res.data.id);
      showToast("Quotation submitted for approval!", "success");
    } catch (err: any) {
      showToast(err.message || "Failed to submit for approval", "error");
    }
  };

  const handleApprove = async () => {
    if (!approvalRequest) return;
    try {
      await api.post(`/api/v1/approvals/${approvalRequest.id}/approve`, {});
      showToast("Quotation step approved successfully!", "success");
      fetchQuote();
    } catch (err: any) {
      showToast(err.message || "Failed to approve quotation step", "error");
    }
  };

  const handleReject = async () => {
    if (!approvalRequest) return;
    try {
      await api.post(`/api/v1/approvals/${approvalRequest.id}/reject`, {});
      showToast("Quotation rejected", "info");
      fetchQuote();
    } catch (err: any) {
      showToast(err.message || "Failed to reject quotation", "error");
    }
  };

  const handleCancelQuoteConfirm = async () => {
    setCancelling(true);
    try {
      const res = await api.post<ApiResponse<QuotationDetail>>(`/api/v1/quotations/${quoteId}/cancel`);
      setQuote(res.data);
      setShowCancelModal(false);
      showToast("Quotation cancelled successfully", "success");
    } catch (err: any) {
      showToast(err.message || "Failed to cancel quotation", "error");
    } finally {
      setCancelling(false);
    }
  };

  const openAddModalWithDefaults = () => {
    if (isLocked) return;
    setShowAddModal(true);
    setSearchTerm("");
    setSelectedCategoryId(0);
    fetchProducts(0, "");
  };

  if (loading) return <div className="p-8 text-slate-500 font-medium">Loading quotation builder...</div>;
  if (error || !quote) return <div className="p-8 text-rose-600 font-bold">{error || "Quotation not found"}</div>;

  const activeRecs = recommendations.filter((r) => !dismissedRecIds.includes(r.id));

  return (
    <div className="w-full space-y-6">
      <CustomerFormModal
        isOpen={showCreateCustomerModal}
        onClose={() => setShowCreateCustomerModal(false)}
        onSuccess={handleCustomerCreated}
      />

      {/* Toast Notification Banner */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg border text-xs font-bold transition flex items-center gap-2 ${toast.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : toast.type === "error"
                ? "bg-rose-50 text-rose-800 border-rose-200"
                : "bg-blue-50 text-blue-800 border-blue-200"
            }`}
        >
          <span>{toast.type === "success" ? "✓" : toast.type === "error" ? "⚠️" : "ℹ️"}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top Breadcrumb & Quick Status Indicator */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <Link href="/internal/quotations" className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1">
          ← Back to Quotations List
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded border border-blue-200">
            Status: {quote.status}
          </span>
          {quote.status === "APPROVED" && (
            <button
              onClick={() => handleStatusChange("CONFIRMED")}
              className="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-emerald-700 transition"
            >
              ✓ Confirm Quote
            </button>
          )}
        </div>
      </div>

      {/* Dynamic Lifecycle Guidance Banner */}
      <div className={`p-4 rounded-xl border text-xs font-semibold flex items-center justify-between shadow-xs ${quote.status === "CONFIRMED"
          ? "bg-slate-900 text-slate-100 border-slate-800"
          : quote.status === "APPROVED"
            ? "bg-emerald-50 text-emerald-900 border-emerald-200"
            : quote.status === "PENDING_APPROVAL"
              ? "bg-amber-50 text-amber-900 border-amber-200"
              : quote.status === "NEGOTIATION"
                ? "bg-purple-50 text-purple-900 border-purple-200"
                : quote.status === "REJECTED"
                  ? "bg-rose-50 text-rose-900 border-rose-200"
                  : "bg-blue-50 text-blue-900 border-blue-200"
        }`}>
        <div className="flex items-center gap-2.5">
          <span className="text-base">
            {quote.status === "CONFIRMED" ? "🔒" : quote.status === "APPROVED" ? "✓" : quote.status === "PENDING_APPROVAL" ? "⏳" : quote.status === "NEGOTIATION" ? "💬" : quote.status === "REJECTED" ? "❌" : "📝"}
          </span>
          <div>
            <div className="font-extrabold text-sm">
              {quote.status === "CONFIRMED" && "Confirmed"}
              {quote.status === "APPROVED" && "Approved — Ready for Confirmation"}
              {quote.status === "PENDING_APPROVAL" && "Pending Approval Review"}
              {quote.status === "NEGOTIATION" && "Negotiation — Re-approval Required"}
              {quote.status === "REJECTED" && "Rejected — Adjustments Needed"}
              {quote.status === "DRAFT" && "Draft — Editing Allowed"}
            </div>
            <div className="text-xs opacity-90 mt-0.5">
              {quote.status === "CONFIRMED" && "This quotation has been confirmed. All commercial terms and lines are locked against further modification."}
              {quote.status === "APPROVED" && "Commercial terms passed all required approvals. Click 'Confirm Quote' to lock and proceed to fulfillment."}
              {quote.status === "PENDING_APPROVAL" && (
                isAuthorizedApprover
                  ? `Action Required: You are an authorized approver for Step ${activePendingStep.sequence} (${activePendingStep.role_name || `Role #${activePendingStep.role_id}`}).`
                  : `Currently undergoing approval review by ${activePendingStep?.role_name || (activePendingStep ? `Role #${activePendingStep.role_id}` : "Management")}.`
              )}
              {quote.status === "NEGOTIATION" && "Commercial terms were modified after approval. Submit changes to start a new approval review cycle."}
              {quote.status === "REJECTED" && "Commercial terms were rejected by management. Edit quantities or discounts and submit for approval again."}
              {quote.status === "DRAFT" && "Add line items, select customer tier, and configure discounts before submitting for approval."}
            </div>
          </div>
        </div>
        <span className="font-bold uppercase tracking-wider font-mono text-[10px] px-2.5 py-1 rounded bg-white/40 border border-current shrink-0">
          {quote.status}
        </span>
      </div>

      {/* Screen Title */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          Quotation Detail: {quote.quotation_number} ({quote.customer_name})
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Configure customer, pricing tier, line items, order discounts, and review governance risk.
        </p>
      </div>

      {/* Customer & Price List Header Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Select Customer</label>
            {!isLocked && (
              <button
                onClick={() => setShowCreateCustomerModal(true)}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
              >
                + Create New Customer
              </button>
            )}
          </div>
          <select
            disabled={isLocked}
            value={quote.customer_id}
            onChange={(e) => handleCustomerChange(Number(e.target.value))}
            className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-extrabold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-50 truncate disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.company ? `(${c.company})` : ""} — {c.tier_name || "Bronze"} Tier ({c.currency_code})
              </option>
            ))}
          </select>
          <div className="text-xs text-slate-500 mt-1.5 flex justify-between">
            <span>Sales Rep: {quote.sales_rep_name}</span>
            <span className="font-semibold text-slate-700">{quote.tier_name || "Enterprise"} Tier</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Price Matrix & Discounts</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">Tax Rate (%):</label>
              <input
                disabled={isLocked}
                type="number"
                step="0.1"
                min="0"
                value={quote.tax_rate_pct}
                onChange={(e) => handleTaxRateChange(parseFloat(e.target.value) || 0)}
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none text-center bg-slate-50 mt-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">Order Disc (%):</label>
              <input
                disabled={isLocked}
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={quote.order_discount_pct || 0}
                onChange={(e) => handleOrderDiscountChange(parseFloat(e.target.value) || 0)}
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-bold text-amber-700 focus:ring-2 focus:ring-amber-500 focus:outline-none text-center bg-slate-50 mt-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-1 font-mono">Quote Currency: {quote.currency_code}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Deal Notes / Terms</label>
          <input
            disabled={isLocked}
            type="text"
            value={quote.notes || ""}
            onChange={(e) => setQuote({ ...quote, notes: e.target.value })}
            onBlur={(e) => handleNotesChange(e.target.value)}
            placeholder="Add deal notes or commercial terms..."
            className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      {/* Approval Status & Steps Timeline Box */}
      {approvalRequest && (
        <div className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Approval Workflow:</span>
              <span
                className={`px-2 py-0.5 text-xs font-bold rounded ${approvalRequest.status === "APPROVED"
                    ? "bg-emerald-500 text-white"
                    : approvalRequest.status === "REJECTED"
                      ? "bg-rose-500 text-white"
                      : "bg-amber-500 text-slate-900"
                  }`}
              >
                {approvalRequest.status}
              </span>
            </div>
            <div className="text-xs font-mono">
              Risk Level: <span className="font-extrabold text-amber-400">{approvalRequest.risk_level}</span> (Overage: +{approvalRequest.total_overage}pt)
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-800">
            {approvalRequest.steps.map((step) => (
              <div key={step.id} className="bg-slate-800 p-2.5 rounded-lg border border-slate-700 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-slate-200">Step {step.sequence}: {step.role_name || `Role #${step.role_id}`}</div>
                  <div className="text-[10px] text-slate-400">{step.decided_at ? new Date(step.decided_at).toLocaleDateString() : "Awaiting decision"}</div>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${step.status === "APPROVED"
                      ? "bg-emerald-900 text-emerald-300"
                      : step.status === "REJECTED"
                        ? "bg-rose-900 text-rose-300"
                        : "bg-amber-900 text-amber-300"
                    }`}
                >
                  {step.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Product Line Items Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-extrabold text-slate-800 text-sm">Product Lines ({quote.lines?.length || 0})</h2>
          {!isLocked && (
            <button
              onClick={openAddModalWithDefaults}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 text-xs font-semibold shadow-xs"
            >
              + Add Product Line
            </button>
          )}
        </div>

        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-100/70 text-slate-600 font-bold uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left">Product & Variant</th>
              <th className="px-4 py-3 text-center w-24">Type</th>
              <th className="px-4 py-3 text-right">Unit Cost</th>
              <th className="px-4 py-3 text-center w-24">Qty</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-center w-24">Discount</th>
              <th className="px-4 py-3 text-center w-32">Limit / Status</th>
              <th className="px-4 py-3 text-right">Line Total</th>
              <th className="px-4 py-3 text-right">Margin</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {(quote.lines || []).length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                  No line items added yet. Click &quot;+ Add Product Line&quot; to begin building this quotation.
                </td>
              </tr>
            ) : (
              (quote.lines || []).map((line) => {
                const policy = quote.discount_analysis?.lines?.find((l) => l.id === line.id || l.product_id === line.product_id);
                const discPct = Number(line.applied_discount_pct || 0);
                const allowedPct = policy ? Number(policy.allowed_discount_pct) : null;
                const isOver = policy ? policy.is_flagged : (allowedPct !== null && discPct > allowedPct);
                const isUpdating = updatingLineId === line.id;

                return (
                  <tr key={line.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{line.product_name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-slate-400 text-[10px]">{line.product_sku}</span>
                        {line.variant_name && (
                          <span className="bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-bold px-1.5 py-0.2 rounded">
                            Variant: {line.variant_name}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Unit Cost */}
                    <td className="px-4 py-3 text-right text-slate-500 font-mono">
                      {format(line.unit_cost)}
                    </td>

                    {/* Qty Input */}
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${line.product_type === "RECURRING"
                            ? "bg-indigo-100 text-indigo-800"
                            : "bg-slate-100 text-slate-700"
                          }`}
                      >
                        {line.product_type || "ONE_TIME"}
                      </span>
                    </td>

                    {/* Qty Input */}
                    <td className="px-4 py-3 text-center">
                      <div className="relative inline-block">
                        <input
                          disabled={isLocked}
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={(e) =>
                            handleLineInputChange(
                              line.id,
                              parseInt(e.target.value) || 1,
                              line.applied_discount_pct
                            )
                          }
                          className="w-16 border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                        {isUpdating && (
                          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Price */}
                    <td className="px-4 py-3 text-right font-semibold text-slate-800 font-mono">
                      {format(line.unit_price)}
                    </td>

                    {/* Discount Input */}
                    <td className="px-4 py-3 text-center">
                      <input
                        disabled={isLocked}
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={line.applied_discount_pct}
                        onChange={(e) =>
                          handleLineInputChange(
                            line.id,
                            line.quantity,
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="w-16 border border-slate-300 rounded px-2 py-1 text-center font-bold text-amber-600 focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </td>

                    {/* Limit / Status */}
                    <td className="px-4 py-3 text-center">
                      {allowedPct === null ? (
                        <span className="text-[10px] text-slate-400 font-medium">Policy N/A</span>
                      ) : isOver ? (
                        <span className="inline-block bg-amber-100 text-amber-900 border border-amber-300 font-extrabold px-2 py-0.5 rounded text-[10px]">
                          OVER (+{discPct - allowedPct}pt)
                        </span>
                      ) : (
                        <span className="inline-block bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold px-2 py-0.5 rounded text-[10px]">
                          OK ({allowedPct}% Max)
                        </span>
                      )}
                    </td>

                    {/* Line Total */}
                    <td className="px-4 py-3 text-right font-extrabold text-slate-900 font-mono">
                      {format(line.line_total)}
                    </td>

                    {/* Margin */}
                    <td className="px-4 py-3 text-right">
                      <div className="font-bold text-emerald-700 font-mono">
                        {format(line.line_margin)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {(Number(line.line_subtotal) > 0 ? (Number(line.line_margin) / Number(line.line_subtotal)) * 100 : 0).toFixed(1)}%
                      </div>
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 text-right">
                      {!isLocked ? (
                        <button
                          onClick={() => handleDeleteLine(line.id)}
                          className="text-rose-600 hover:text-rose-800 font-semibold"
                        >
                          Delete
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-mono">Locked</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Live Overage Banner Notice */}
      {quote.discount_analysis && quote.discount_analysis.total_overage > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">⚡</span>
            <span>
              Quote contains <strong>+{quote.discount_analysis.total_overage}pt total overage</strong> (Line & Order discount combined). Submitting will require Manager/Finance approval.
            </span>
          </div>
          <span className="font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded font-mono">
            Risk: {quote.risk_level}
          </span>
        </div>
      )}

      {/* Dynamic Recommendations Section */}
      {!isLocked && activeRecs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <span>✨ Recommended Additions</span>
            <span className="text-xs text-slate-400 font-normal">(Based on active products in quotation)</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {activeRecs.map((rec) => (
              <div
                key={rec.id}
                className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${rec.relationship_type === "UPSELL" ? "bg-blue-600 text-white" : "bg-emerald-600 text-white"
                        }`}
                    >
                      {rec.relationship_type}
                    </span>
                    <button
                      onClick={() => setDismissedRecIds((prev) => [...prev, rec.id])}
                      className="text-slate-400 hover:text-white text-xs font-bold px-1"
                      title="Dismiss suggestion"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="font-bold text-sm text-slate-100 mt-2">{rec.related_product_name}</div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">SKU: {rec.related_product_sku}</div>
                </div>

                <div className="mt-4 pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[11px] text-blue-300 font-semibold">Tier Price Auto-Resolved</span>
                  <button
                    onClick={() => handleAddLineItem(rec.related_product_id, null, 1, 0)}
                    className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-blue-700 transition"
                  >
                    + Add to Quote
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Complete Totals Summary Footer & Context-Aware Action Bar */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-4 text-xs w-full md:w-auto">
          <div>
            <span className="text-slate-400 block font-semibold">Subtotal</span>
            <span className="font-bold text-slate-800">{format(quote.subtotal)}</span>
          </div>

          <div>
            <span className="text-slate-400 block font-semibold">Line Disc. Total</span>
            <span className="font-bold text-amber-600">
              -{format(Number(quote.discount_total) - Number(quote.order_discount_amount || 0))}
            </span>
          </div>

          <div>
            <span className="text-slate-400 block font-semibold">Order Disc ({quote.order_discount_pct || 0}%)</span>
            <span className="font-bold text-amber-700">
              -{format(Number(quote.order_discount_amount || 0))}
            </span>
          </div>

          <div>
            <span className="text-slate-400 block font-semibold">Total Cost</span>
            <span className="font-bold text-slate-700">{format(Number(quote.total_cost || 0))}</span>
          </div>

          <div>
            <span className="text-slate-400 block font-semibold">Margin ({Number(quote.margin_pct || 0).toFixed(1)}%)</span>
            <span className="font-bold text-emerald-700">{format(Number(quote.margin_amount || 0))}</span>
          </div>

          <div>
            <span className="text-slate-400 block font-semibold">Tax ({quote.tax_rate_pct}%)</span>
            <span className="font-bold text-slate-700">{format(quote.tax_total)}</span>
          </div>

          <div>
            <span className="text-slate-400 block font-semibold">Grand Total</span>
            <span className="text-base font-extrabold text-blue-700">{format(quote.grand_total)}</span>
          </div>

          <div>
            <span className="text-slate-400 block font-semibold">Margin Amount</span>
            <span className="font-bold text-emerald-700">{format(quote.margin_amount)}</span>
          </div>

          <div>
            <span className="text-slate-400 block font-semibold">Margin Pct</span>
            <span className="font-extrabold text-emerald-700">{Number(quote.margin_pct).toFixed(1)}%</span>
          </div>
        </div>

        {/* Dynamic Context-Aware Action Buttons */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => exportQuotationPdf(quote)}
            className="px-4 py-2.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-xs flex items-center gap-1.5"
          >
            <span>⬇</span> Export PDF
          </button>
          {quote.status === "CONFIRMED" ? (
            <button disabled className="px-5 py-2.5 bg-slate-800 text-slate-300 rounded-lg text-xs font-bold shadow-xs cursor-not-allowed flex items-center gap-1.5">
              Confirmed
            </button>
          ) : quote.status === "CANCELLED" ? (
            <button disabled className="px-5 py-2.5 bg-rose-100 text-rose-800 border border-rose-200 rounded-lg text-xs font-bold shadow-xs cursor-not-allowed flex items-center gap-1.5">
              Cancelled
            </button>
          ) : (
            <>
              {/* Primary Actions based on State */}
              {quote.status === "APPROVED" ? (
                <button
                  onClick={() => handleStatusChange("CONFIRMED")}
                  className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition shadow-xs flex items-center gap-1.5"
                >
                  <span>✓</span> Confirm Quote
                </button>
              ) : quote.status === "PENDING_APPROVAL" ? (
                isAuthorizedApprover ? (
                  <>
                    <button
                      onClick={handleReject}
                      className="px-4 py-2.5 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 transition shadow-xs"
                    >
                      Reject
                    </button>
                    <button
                      onClick={handleApprove}
                      className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition shadow-xs flex items-center gap-1.5"
                    >
                      <span>✓</span> Approve
                    </button>
                  </>
                ) : (
                  <button disabled className="px-5 py-2.5 bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-bold shadow-xs cursor-not-allowed flex items-center gap-1.5">
                    <span>⏳</span> Waiting for Approval
                  </button>
                )
              ) : quote.status === "NEGOTIATION" ? (
                <>
                  <button
                    onClick={() => handleStatusChange("DRAFT")}
                    className="px-4 py-2.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                  >
                    Save Draft
                  </button>
                  <button
                    onClick={handleSubmitApproval}
                    className="px-5 py-2.5 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 transition shadow-xs"
                  >
                    Submit Changes for Approval
                  </button>
                </>
              ) : quote.status === "DRAFT" ? (
                <>
                  <button
                    onClick={() => handleStatusChange("DRAFT")}
                    className="px-4 py-2.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                  >
                    Save Draft
                  </button>
                  <button
                    onClick={handleSubmitApproval}
                    className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition shadow-xs"
                  >
                    Submit for Approval
                  </button>
                </>
              ) : (
                /* REJECTED / Fallback */
                <button
                  onClick={handleSubmitApproval}
                  className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition shadow-xs"
                >
                  Submit for Approval
                </button>
              )}

              {/* Cancel Quote Action */}
              <button
                onClick={() => setShowCancelModal(true)}
                className="px-4 py-2.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold hover:bg-rose-100 transition shadow-xs"
              >
                Cancel Quote
              </button>
            </>
          )}
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-600">
              <span className="text-xl">⚠️</span>
              <h2 className="text-lg font-extrabold text-slate-900">Cancel Quotation?</h2>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              This quotation will be marked as <strong>Cancelled</strong>. It will remain in database records and audit history, but cannot be modified or approved further.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                disabled={cancelling}
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
              >
                Keep Quote
              </button>
              <button
                disabled={cancelling}
                onClick={handleCancelQuoteConfirm}
                className="px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 transition shadow-xs flex items-center gap-1.5"
              >
                {cancelling ? "Cancelling..." : "Cancel Quote"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Line Modal */}
      {!isLocked && showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full shadow-2xl border border-slate-100 space-y-4">
            <h2 className="text-lg font-extrabold text-slate-900">Add Product Line</h2>

            {/* Category Filter & Search Bar */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Category Filter</label>
                <select
                  value={selectedCategoryId}
                  onChange={(e) => {
                    const catId = Number(e.target.value);
                    setSelectedCategoryId(catId);
                    fetchProducts(catId, searchTerm);
                  }}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
                >
                  <option value={0}>All Categories ({categories.length})</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Search Product / SKU</label>
                <input
                  type="text"
                  placeholder="Type name or SKU..."
                  value={searchTerm}
                  onChange={(e) => {
                    const term = e.target.value;
                    setSearchTerm(term);
                    fetchProducts(selectedCategoryId, term);
                  }}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
                />
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddLineItem(selectedProductId, selectedVariantId, lineQty, lineDiscount);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Product</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => {
                    const pId = Number(e.target.value);
                    setSelectedProductId(pId);
                    fetchVariantsForProduct(pId);
                  }}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none font-medium"
                >
                  {availableProducts.length === 0 ? (
                    <option value={0}>No products found</option>
                  ) : (
                    availableProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku}) {p.category_name ? `[${p.category_name}]` : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Variant Selector */}
              {loadingVariants ? (
                <div className="text-xs text-slate-400 italic">Checking for product variants...</div>
              ) : productVariants.length > 0 ? (
                <div>
                  <label className="block text-xs font-bold text-purple-900 mb-1">Select Product Variant (*Required)</label>
                  <select
                    value={selectedVariantId || 0}
                    onChange={(e) => setSelectedVariantId(Number(e.target.value))}
                    required
                    className="w-full border border-purple-300 rounded-lg px-3 py-2 text-sm font-bold text-purple-900 bg-purple-50 focus:outline-none"
                  >
                    {productVariants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.sku})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={lineQty}
                    onChange={(e) => setLineQty(parseInt(e.target.value) || 1)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Line Discount (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={lineDiscount}
                    onChange={(e) => setLineDiscount(parseFloat(e.target.value) || 0)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={availableProducts.length === 0 || (productVariants.length > 0 && !selectedVariantId)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 shadow-xs disabled:opacity-50"
                >
                  Add to Quote
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
