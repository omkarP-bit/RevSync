import { jsPDF } from "jspdf";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_Y = PAGE_HEIGHT - 30;

export const fmtMoney = (n: number | string | null | undefined): string =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const fmtDate = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString();
};

export interface PdfTableOptions {
  headers: string[];
  rows: (string | number)[][];
  colWidths: number[];
  align?: ("left" | "right" | "center")[];
  title?: string;
  footerRow?: (string | number)[];
  striped?: boolean;
}

interface DrawState {
  doc: jsPDF;
  y: number;
}

function ensureSpace(state: DrawState, needed: number): void {
  if (state.y + needed > PAGE_HEIGHT - 60) {
    state.doc.addPage();
    state.y = MARGIN + 20;
  }
}

function drawHeaderBand(state: DrawState, headers: string[], colWidths: number[], align: ("left" | "right" | "center")[]): void {
  const doc = state.doc;
  ensureSpace(state, 24);
  doc.setFillColor(241, 245, 249);
  doc.rect(MARGIN, state.y, CONTENT_WIDTH, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  const rowStart = state.y;
  headers.forEach((h, i) => {
    const x = MARGIN + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
    doc.text(h, x + (align[i] === "right" ? colWidths[i] - 4 : align[i] === "center" ? colWidths[i] / 2 : 4), rowStart + 15, {
      align: align[i] === "right" ? "right" : align[i] === "center" ? "center" : "left",
    });
  });
  state.y = rowStart + 22;
}

function drawTable(state: DrawState, opts: PdfTableOptions): void {
  const doc = state.doc;
  if (opts.title) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    ensureSpace(state, 18);
    doc.text(opts.title, MARGIN, state.y + 12);
    state.y += 22;
  }

  const align = opts.align ?? opts.headers.map(() => "left" as const);
  drawHeaderBand(state, opts.headers, opts.colWidths, align);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const lineHeight = 11;
  const baseRowHeight = 14;

  opts.rows.forEach((row, idx) => {
    const cells = row.map((cell, i) => {
      const x = MARGIN + opts.colWidths.slice(0, i).reduce((a, b) => a + b, 0);
      const wrapped = doc.splitTextToSize(String(cell ?? ""), opts.colWidths[i] - 8);
      return { x, wrapped };
    });
    const lineCount = cells.length > 0 ? Math.max(...cells.map((c) => c.wrapped.length), 1) : 1;
    const rowHeight = Math.max(baseRowHeight, lineCount * lineHeight + 6);

    ensureSpace(state, rowHeight);
    const y = state.y;
    if (opts.striped !== false && idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight, "F");
    }
    doc.setTextColor(51, 65, 85);
    cells.forEach((cell, i) => {
      const textAlign = align[i] === "right" ? "right" : align[i] === "center" ? "center" : "left";
      const tx = align[i] === "right" ? cell.x + opts.colWidths[i] - 4 : align[i] === "center" ? cell.x + opts.colWidths[i] / 2 : cell.x + 4;
      cell.wrapped.forEach((line: string, li: number) => {
        doc.text(line, tx, y + 10 + li * lineHeight, { align: textAlign });
      });
    });
    state.y = y + rowHeight;
  });

  doc.setDrawColor(226, 232, 240);
  doc.line(MARGIN, state.y, MARGIN + CONTENT_WIDTH, state.y);
  state.y += 6;

  if (opts.footerRow) {
    ensureSpace(state, 18);
    doc.setFillColor(241, 245, 249);
    doc.rect(MARGIN, state.y, CONTENT_WIDTH, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    opts.footerRow.forEach((cell, i) => {
      const x = MARGIN + opts.colWidths.slice(0, i).reduce((a, b) => a + b, 0);
      const textAlign = align[i];
      const tx = textAlign === "right" ? x + opts.colWidths[i] - 4 : textAlign === "center" ? x + opts.colWidths[i] / 2 : x + 4;
      doc.text(String(cell ?? ""), tx, state.y + 12, { align: textAlign });
    });
    state.y += 18;
  }
  state.y += 8;
}

function addBrandHeader(doc: jsPDF, title: string, subtitle: string): DrawState {
  doc.setFillColor(29, 78, 216);
  doc.rect(0, 0, PAGE_WIDTH, 56, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text("RevSync", MARGIN, 24);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(title, MARGIN, 42);
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(9);
  doc.text(subtitle, PAGE_WIDTH - MARGIN, 42, { align: "right" });
  return { doc, y: 76 };
}

function finishDoc(doc: jsPDF, filename: string, footerNote: string): void {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text(footerNote, MARGIN, FOOTER_Y);
    doc.text(`Page ${i} of ${pages}`, PAGE_WIDTH - MARGIN, FOOTER_Y, { align: "right" });
  }
  doc.save(filename);
}

function metaBlock(state: DrawState, items: [string, string][]): DrawState {
  const doc = state.doc;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  items.forEach(([label, value]) => {
    ensureSpace(state, 13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 116, 139);
    doc.text(label, MARGIN, state.y);
    const labelWidth = Math.max(...items.map(([l]) => l.length)) * 5 + 6;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(value, MARGIN + labelWidth, state.y);
    state.y += 13;
  });
  state.y += 8;
  return state;
}

export interface PdfQuotationLine {
  product_name: string;
  product_sku?: string | null;
  variant_name?: string | null;
  unit_price: number;
  quantity: number;
  applied_discount_pct?: number | null;
  line_total: number;
}

export interface PdfQuotation {
  quotation_number: string;
  customer_name: string;
  currency_code: string;
  status: string;
  sales_rep_name?: string | null;
  created_at?: string | null;
  valid_until?: string | null;
  tier_name?: string | null;
  customer_email?: string | null;
  notes?: string | null;
  subtotal: number;
  discount_total: number;
  order_discount_pct?: number | null;
  order_discount_amount?: number | null;
  tax_rate_pct: number;
  tax_total: number;
  grand_total: number;
  lines: PdfQuotationLine[];
}

export function exportQuotationPdf(quote: PdfQuotation): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let state = addBrandHeader(doc, `Quotation ${quote.quotation_number}`, fmtDate(quote.created_at));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(quote.customer_name, MARGIN, state.y);
  state.y += 18;

  state = metaBlock(state, [
    ["Quotation", quote.quotation_number],
    ["Status", quote.status],
    ["Sales Rep", quote.sales_rep_name || "—"],
    ["Customer Tier", quote.tier_name || "—"],
    ["Valid Until", fmtDate(quote.valid_until) || "—"],
    ["Currency", quote.currency_code],
  ]);

  const colWidths = [230, 70, 70, 62, 83];
  const rows = (quote.lines || []).map((l) => [
    l.variant_name ? `${l.product_name} (${l.variant_name})` : l.product_name,
    String(l.quantity),
    `${quote.currency_code} ${fmtMoney(l.unit_price)}`,
    l.applied_discount_pct ? `${Number(l.applied_discount_pct)}%` : "0%",
    `${quote.currency_code} ${fmtMoney(l.line_total)}`,
  ]);
  state = drawTableTo(state, {
    title: "Line Items",
    headers: ["Product", "Qty", "Unit Price", "Disc.", "Line Total"],
    rows,
    colWidths,
    align: ["left", "center", "right", "right", "right"],
    footerRow: ["", "", "", "", `${quote.currency_code} ${fmtMoney(quote.grand_total)}`],
  });

  const summary: [string, string][] = [
    ["Subtotal", `${quote.currency_code} ${fmtMoney(quote.subtotal)}`],
    ["Line Discounts", `-${quote.currency_code} ${fmtMoney(quote.discount_total || 0)}`],
  ];
  if (Number(quote.order_discount_amount)) {
    summary.push([`Order Discount (${Number(quote.order_discount_pct || 0)}%)`, `-${quote.currency_code} ${fmtMoney(quote.order_discount_amount || 0)}`]);
  }
  summary.push([`Tax (${Number(quote.tax_rate_pct)}%)`, `${quote.currency_code} ${fmtMoney(quote.tax_total)}`]);
  summary.push(["Grand Total", `${quote.currency_code} ${fmtMoney(quote.grand_total)}`]);

  ensureSpace(state, summary.length * 16 + 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("Summary", MARGIN, state.y);
  state.y += 16;

  summary.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(label, MARGIN, state.y);
    doc.setFont("helvetica", label === "Grand Total" ? "bold" : "normal");
    if (label === "Grand Total") doc.setTextColor(29, 78, 216);
    else doc.setTextColor(15, 23, 42);
    doc.text(value, PAGE_WIDTH - MARGIN, state.y, { align: "right" });
    state.y += 14;
  });

  if (quote.notes) {
    state.y += 10;
    ensureSpace(state, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text("Notes / Terms", MARGIN, state.y);
    state.y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    const wrapped = doc.splitTextToSize(quote.notes, CONTENT_WIDTH);
    doc.text(wrapped, MARGIN, state.y);
    state.y += wrapped.length * 11;
  }

  finishDoc(doc, `revsync-quotation-${quote.quotation_number}.pdf`, `Generated for ${quote.customer_name}`);
}

export interface PdfPayment {
  reference?: string | null;
  amount_paid: number;
  payment_date: string;
  payment_method?: string | null;
}

export interface PdfInvoiceLine {
  product_name: string;
  sku?: string | null;
  quantity: number;
  unit_price: number;
  applied_discount_pct?: number | null;
  line_total: number;
}

export interface PdfInvoice {
  invoice_number: string;
  quotation_number?: string | null;
  customer_name: string;
  currency_code: string;
  status: string;
  issue_date?: string | null;
  due_date?: string | null;
  notes?: string | null;
  subtotal: number;
  discount_total: number;
  tax_rate_pct: number;
  tax_total: number;
  grand_total: number;
  total_paid: number;
  lines: PdfInvoiceLine[];
  payments?: PdfPayment[];
}

export function exportInvoicePdf(invoice: PdfInvoice): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let state = addBrandHeader(doc, `Invoice ${invoice.invoice_number}`, `${invoice.status}`);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(invoice.customer_name, MARGIN, state.y);
  state.y += 18;

  state = metaBlock(state, [
    ["Invoice", invoice.invoice_number],
    ["Quotation", invoice.quotation_number || "—"],
    ["Issued", fmtDate(invoice.issue_date)],
    ["Due", fmtDate(invoice.due_date)],
    ["Status", invoice.status],
    ["Currency", invoice.currency_code],
  ]);

  const colWidths = [230, 70, 70, 62, 83];
  const rows = (invoice.lines || []).map((l) => [
    l.product_name,
    String(l.quantity),
    `${invoice.currency_code} ${fmtMoney(l.unit_price)}`,
    l.applied_discount_pct ? `${Number(l.applied_discount_pct)}%` : "0%",
    `${invoice.currency_code} ${fmtMoney(l.line_total)}`,
  ]);
  state = drawTableTo(state, {
    title: "Line Items",
    headers: ["Product", "Qty", "Unit Price", "Disc.", "Line Total"],
    rows,
    colWidths,
    align: ["left", "center", "right", "right", "right"],
    footerRow: ["", "", "", "", `${invoice.currency_code} ${fmtMoney(invoice.grand_total)}`],
  });

  const balance = Math.max(Number(invoice.grand_total) - Number(invoice.total_paid), 0);
  const summary: [string, string][] = [
    ["Subtotal", `${invoice.currency_code} ${fmtMoney(invoice.subtotal)}`],
    ["Discount Total", `-${invoice.currency_code} ${fmtMoney(invoice.discount_total || 0)}`],
    [`Tax (${Number(invoice.tax_rate_pct)}%)`, `${invoice.currency_code} ${fmtMoney(invoice.tax_total)}`],
    ["Grand Total", `${invoice.currency_code} ${fmtMoney(invoice.grand_total)}`],
    ["Paid", `${invoice.currency_code} ${fmtMoney(invoice.total_paid)}`],
    ["Balance Due", `${invoice.currency_code} ${fmtMoney(balance)}`],
  ];

  ensureSpace(state, summary.length * 16 + 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("Summary", MARGIN, state.y);
  state.y += 16;

  summary.forEach(([label, value]) => {
    const isTotal = label === "Grand Total" || label === "Balance Due";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(label, MARGIN, state.y);
    doc.setFont("helvetica", isTotal ? "bold" : "normal");
    if (label === "Balance Due") doc.setTextColor(220, 38, 38);
    else if (label === "Grand Total") doc.setTextColor(29, 78, 216);
    else doc.setTextColor(15, 23, 42);
    doc.text(value, PAGE_WIDTH - MARGIN, state.y, { align: "right" });
    state.y += 14;
  });

  if (invoice.payments && invoice.payments.length > 0) {
    state.y += 6;
    state = drawTableTo(state, {
      title: "Payments",
      headers: ["Reference", "Date", "Method", "Amount"],
      rows: invoice.payments.map((p) => [
        p.reference || "—",
        fmtDate(p.payment_date),
        p.payment_method || "—",
        `${invoice.currency_code} ${fmtMoney(p.amount_paid)}`,
      ]),
      colWidths: [180, 110, 140, 85],
      align: ["left", "left", "left", "right"],
    });
  }

  if (invoice.notes) {
    state.y += 6;
    ensureSpace(state, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text("Notes", MARGIN, state.y);
    state.y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    const wrapped = doc.splitTextToSize(invoice.notes as string, CONTENT_WIDTH);
    doc.text(wrapped, MARGIN, state.y);
  }

  finishDoc(doc, `revsync-invoice-${invoice.invoice_number}.pdf`, `Due ${fmtDate(invoice.due_date)} · ${invoice.customer_name}`);
}

export interface PdfReport {
  base_currency: string;
  from: string;
  to: string;
  overview?: {
    pipeline: { total_quotations: number; confirmed_count: number; open_value: number; confirmed_value: number; win_rate: number };
    revenue: { invoiced: number; collected: number; outstanding: number; overdue_count: number };
    subscriptions: { active_count: number; monthly_recurring_value: number };
    fulfillment: { orders_total: number; partial_count: number; units_backordered: number };
    deal_health: { healthy: number; at_risk: number; critical: number };
  };
  months: { period: string; invoiced: number; collected: number; outstanding: number }[];
  sales_reps: { sales_rep_name: string; quotation_count: number; confirmed_count: number; confirmed_value: number; pipeline_value: number }[];
  top_customers: { customer_name: string; company: string | null; invoice_count: number; invoiced: number; collected: number; overdue_count: number }[];
  statuses: { status: string; count: number; value: number; avg_ticket: number }[];
}

export function exportReportPdf(report: PdfReport): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let state = addBrandHeader(doc, "Business Reports", `${report.from} → ${report.to}`);

  if (report.overview) {
    const o = report.overview;
    const kpis: [string, string][] = [
      ["Invoiced Revenue", `${report.base_currency} ${fmtMoney(o.revenue.invoiced)}`],
      ["Collected", `${report.base_currency} ${fmtMoney(o.revenue.collected)}`],
      ["Outstanding", `${report.base_currency} ${fmtMoney(o.revenue.outstanding)}`],
      ["Open Pipeline", `${report.base_currency} ${fmtMoney(o.pipeline.open_value)}`],
      ["Confirmed Value", `${report.base_currency} ${fmtMoney(o.pipeline.confirmed_value)}`],
      ["Win Rate", `${o.pipeline.win_rate}%`],
      ["Active Subs (MRR)", `${report.base_currency} ${fmtMoney(o.subscriptions.monthly_recurring_value)}`],
      ["Backordered Units", String(o.fulfillment.units_backordered)],
    ];
    state = metaBlock(state, kpis);
  } else {
    state = metaBlock(state, [["Period", `${report.from} → ${report.to}`]]);
  }

  if (report.months && report.months.length > 0) {
    state = drawTableTo(state, {
      title: "Monthly Revenue",
      headers: ["Month", "Invoiced", "Collected", "Outstanding"],
      rows: report.months.map((m) => [
        m.period,
        `${report.base_currency} ${fmtMoney(m.invoiced)}`,
        `${report.base_currency} ${fmtMoney(m.collected)}`,
        `${report.base_currency} ${fmtMoney(m.outstanding)}`,
      ]),
      colWidths: [120, 131, 132, 132],
      align: ["left", "right", "right", "right"],
    });
  }

  if (report.sales_reps && report.sales_reps.length > 0) {
    state = drawTableTo(state, {
      title: "Sales Rep Rankings",
      headers: ["Sales Rep", "Quotes", "Won", "Confirmed Value", "Pipeline Value"],
      rows: report.sales_reps.map((r) => [
        r.sales_rep_name,
        String(r.quotation_count),
        String(r.confirmed_count),
        `${report.base_currency} ${fmtMoney(r.confirmed_value)}`,
        `${report.base_currency} ${fmtMoney(r.pipeline_value)}`,
      ]),
      colWidths: [150, 55, 55, 130, 125],
      align: ["left", "center", "center", "right", "right"],
    });
  }

  if (report.top_customers && report.top_customers.length > 0) {
    state = drawTableTo(state, {
      title: "Top Customers",
      headers: ["Customer", "Invoices", "Invoiced", "Collected", "Overdue"],
      rows: report.top_customers.map((c) => [
        c.company ? `${c.customer_name} (${c.company})` : c.customer_name,
        String(c.invoice_count),
        `${report.base_currency} ${fmtMoney(c.invoiced)}`,
        `${report.base_currency} ${fmtMoney(c.collected)}`,
        String(c.overdue_count),
      ]),
      colWidths: [150, 55, 130, 110, 70],
      align: ["left", "center", "right", "right", "center"],
    });
  }

  if (report.statuses && report.statuses.length > 0) {
    state = drawTableTo(state, {
      title: "Quotation Funnel",
      headers: ["Status", "Count", "Value", "Avg Ticket"],
      rows: report.statuses.map((s) => [
        s.status,
        String(s.count),
        `${report.base_currency} ${fmtMoney(s.value)}`,
        `${report.base_currency} ${fmtMoney(s.avg_ticket)}`,
      ]),
      colWidths: [180, 80, 150, 105],
      align: ["left", "center", "right", "right"],
    });
  }

  finishDoc(doc, `revsync-report-${report.from}-to-${report.to}.pdf`, `RevSync business report · ${report.base_currency}`);
}

export interface PdfPortalInvoiceLine {
  product_name: string;
  sku?: string | null;
  quantity: number;
  unit_price: number;
  applied_discount_pct?: number | null;
  discount_amount?: number | null;
  line_total: number;
}

export interface PdfPortalInvoicePayment {
  reference: string;
  amount_paid: number;
  payment_method: string;
  payment_date: string;
}

export interface PdfPortalInvoice {
  invoice_number: string;
  quotation_number?: string | null;
  status: string;
  issue_date?: string | null;
  due_date?: string | null;
  grand_total: number;
  total_paid: number;
  balance_due: number;
  lines: PdfPortalInvoiceLine[];
  payments?: PdfPortalInvoicePayment[] | null;
  currency_code?: string;
}

export function exportPortalInvoicePdf(invoice: PdfPortalInvoice): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const cc = invoice.currency_code || "$";
  let state = addBrandHeader(doc, `Invoice ${invoice.invoice_number}`, invoice.status);

  state = metaBlock(state, [
    ["Invoice", invoice.invoice_number],
    ["Quotation", invoice.quotation_number || "—"],
    ["Issued", fmtDate(invoice.issue_date)],
    ["Due", fmtDate(invoice.due_date)],
    ["Status", invoice.status],
    ["Currency", cc],
  ]);

  state = drawTableTo(state, {
    title: "Line Items",
    headers: ["Product", "Qty", "Unit Price", "Discount", "Line Total"],
    rows: (invoice.lines || []).map((l) => [
      l.sku ? `${l.product_name} (${l.sku})` : l.product_name,
      String(l.quantity),
      `${cc} ${fmtMoney(l.unit_price)}`,
      Number(l.applied_discount_pct || 0) > 0 ? `-${cc} ${fmtMoney(l.discount_amount || 0)}` : "—",
      `${cc} ${fmtMoney(l.line_total)}`,
    ]),
    colWidths: [180, 50, 95, 105, 85],
    align: ["left", "center", "right", "right", "right"],
  });

  if (invoice.payments && invoice.payments.length > 0) {
    state = drawTableTo(state, {
      title: "Payments",
      headers: ["Reference", "Date", "Method", "Amount"],
      rows: invoice.payments.map((p) => [
        p.reference || "—",
        fmtDate(p.payment_date),
        p.payment_method || "—",
        `${cc} ${fmtMoney(p.amount_paid)}`,
      ]),
      colWidths: [180, 110, 140, 85],
      align: ["left", "left", "left", "right"],
    });
  }

  const balance = Math.max(Number(invoice.balance_due), 0);
  const summary: [string, string][] = [
    ["Grand Total", `${cc} ${fmtMoney(invoice.grand_total)}`],
    ["Paid", `${cc} ${fmtMoney(invoice.total_paid)}`],
    ["Balance Due", `${cc} ${fmtMoney(balance)}`],
  ];

  ensureSpace(state, summary.length * 16 + 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("Summary", MARGIN, state.y);
  state.y += 16;

  summary.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(label, MARGIN, state.y);
    if (label === "Balance Due") doc.setTextColor(220, 38, 38);
    else if (label === "Grand Total") doc.setTextColor(29, 78, 216);
    else doc.setTextColor(15, 23, 42);
    doc.text(value, PAGE_WIDTH - MARGIN, state.y, { align: "right" });
    state.y += 14;
  });

  finishDoc(doc, `revsync-invoice-${invoice.invoice_number}.pdf`, `Invoice ${invoice.invoice_number}`);
}

export interface PdfFulfillmentAllocation {
  warehouse_name: string;
  warehouse_code: string;
  product_name: string;
  quantity: number;
  unit_shipping_cost: number;
}

export interface PdfFulfillment {
  id: number;
  status: string;
  shipping_cost: number;
  backordered_quantity: number;
  shipped_at?: string | null;
  created_at?: string | null;
  notes?: string | null;
  quotation_number: string;
  customer_name: string;
  grand_total: number;
  allocations: PdfFulfillmentAllocation[];
  currency_code?: string;
}

export function exportFulfillmentPdf(order: PdfFulfillment): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const cc = order.currency_code || "$";
  let state = addBrandHeader(doc, `Fulfillment FO-${String(order.id).padStart(4, "0")}`, order.status);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(order.customer_name, MARGIN, state.y);
  state.y += 18;

  state = metaBlock(state, [
    ["Order", `FO-${String(order.id).padStart(4, "0")}`],
    ["Quotation", order.quotation_number],
    ["Status", order.status],
    ["Created", fmtDate(order.created_at)],
    ["Shipped", order.shipped_at ? fmtDate(order.shipped_at) : "—"],
    ["Grand Total", `${cc} ${fmtMoney(order.grand_total)}`],
    ["Shipping Cost", `${cc} ${fmtMoney(order.shipping_cost)}`],
    ["Backordered", `${order.backordered_quantity} units`],
  ]);

  state = drawTableTo(state, {
    title: "Warehouse Allocations",
    headers: ["Warehouse", "Product", "Qty", "Unit Shipping"],
    rows: (order.allocations || []).map((a) => [
      `${a.warehouse_name} (${a.warehouse_code})`,
      a.product_name,
      String(a.quantity),
      `${cc} ${fmtMoney(a.unit_shipping_cost)}`,
    ]),
    colWidths: [180, 200, 55, 80],
    align: ["left", "left", "center", "right"],
  });

  if (order.notes) {
    state.y += 6;
    ensureSpace(state, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text("Notes", MARGIN, state.y);
    state.y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(doc.splitTextToSize(order.notes, CONTENT_WIDTH), MARGIN, state.y);
  }

  finishDoc(doc, `revsync-fulfillment-FO-${String(order.id).padStart(4, "0")}.pdf`, `Fulfillment for ${order.customer_name}`);
}

export interface PdfSubscriptionSchedule {
  billing_date?: string;
  period_start?: string;
  period_end?: string;
  amount: number;
  status: string;
  invoice_number?: string;
}

export interface PdfSubscriptionInvoice {
  invoice_number: string;
  invoice_type: string;
  status: string;
  grand_total: number;
  wallet_offset_amount: number;
  total_paid: number;
  balance_due: number;
  issue_date?: string;
  due_date?: string;
}

export interface PdfSubscriptionHistory {
  change_type: string;
  old_quantity: number;
  new_quantity: number;
  old_period_value: number;
  new_period_value: number;
  remaining_days: number;
  period_days: number;
  proration_amount: number;
  created_at?: string;
}

export interface PdfSubscription {
  id: number;
  public_id?: string;
  customer_name: string;
  customer_email?: string;
  quotation_number?: string;
  plan_name: string;
  product_name: string;
  sku: string;
  status: string;
  quantity: number;
  unit_price: number;
  recurring_amount: number;
  currency: string;
  billing_cycle: string;
  current_period_start?: string;
  current_period_end?: string;
  next_billing_date?: string;
  wallet_balance: number;
  schedules: PdfSubscriptionSchedule[];
  history: PdfSubscriptionHistory[];
  invoices: PdfSubscriptionInvoice[];
}

export function exportSubscriptionPdf(sub: PdfSubscription): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let state = addBrandHeader(doc, sub.plan_name, `${sub.status} · ${sub.billing_cycle}`);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(sub.customer_name, MARGIN, state.y);
  state.y += 18;

  state = metaBlock(state, [
    ["Customer", sub.customer_email || sub.customer_name],
    ["Plan", sub.plan_name],
    ["Status", sub.status],
    ["Billing Cycle", sub.billing_cycle],
    ["Quantity", `${sub.quantity} × ${sub.currency} ${fmtMoney(sub.unit_price)}`],
    ["Recurring Amount", `${sub.currency} ${fmtMoney(sub.recurring_amount)}`],
    ["Next Billing", fmtDate(sub.next_billing_date)],
    ["Wallet Balance", `${sub.currency} ${fmtMoney(sub.wallet_balance)}`],
    ["Quotation", sub.quotation_number || "—"],
  ]);

  if (sub.schedules && sub.schedules.length > 0) {
    state = drawTableTo(state, {
      title: "Billing Schedule",
      headers: ["Period Start", "Period End", "Billing Date", "Status", "Amount"],
      rows: sub.schedules.map((s) => [
        fmtDate(s.period_start),
        fmtDate(s.period_end),
        `${fmtDate(s.billing_date)}${s.invoice_number ? ` · #${s.invoice_number}` : ""}`,
        s.status,
        `${sub.currency} ${fmtMoney(s.amount)}`,
      ]),
      colWidths: [90, 90, 150, 90, 95],
      align: ["left", "left", "left", "center", "right"],
    });
  }

  if (sub.invoices && sub.invoices.length > 0) {
    state = drawTableTo(state, {
      title: "Invoices",
      headers: ["Invoice", "Type", "Total", "Wallet Offset", "Balance Due", "Status"],
      rows: sub.invoices.map((inv) => [
        inv.invoice_number,
        inv.invoice_type,
        `${sub.currency} ${fmtMoney(inv.grand_total)}`,
        `${sub.currency} ${fmtMoney(inv.wallet_offset_amount)}`,
        `${sub.currency} ${fmtMoney(inv.balance_due)}`,
        inv.status,
      ]),
      colWidths: [100, 75, 95, 95, 95, 55],
      align: ["left", "left", "right", "right", "right", "center"],
    });
  }

  if (sub.history && sub.history.length > 0) {
    state = drawTableTo(state, {
      title: "History & Proration",
      headers: ["Change", "Old", "New", "Prorated Days", "Proration", "Date"],
      rows: sub.history.map((h) => [
        h.change_type,
        `${sub.currency} ${fmtMoney(h.old_period_value)} (qty ${h.old_quantity})`,
        `${sub.currency} ${fmtMoney(h.new_period_value)} (qty ${h.new_quantity})`,
        `${h.remaining_days} / ${h.period_days}`,
        `${h.proration_amount > 0 ? "+" : ""}${sub.currency} ${fmtMoney(h.proration_amount)}`,
        fmtDate(h.created_at),
      ]),
      colWidths: [70, 118, 118, 70, 95, 44],
      align: ["left", "left", "left", "center", "right", "left"],
    });
  }

  finishDoc(doc, `revsync-subscription-${sub.public_id || sub.id}.pdf`, `${sub.customer_name} · ${sub.plan_name}`);
}

export interface PdfNegotiationRequest {
  request_type: string;
  status: string;
  product_name?: string | null;
  original_value?: string | null;
  requested_value: string;
  message?: string | null;
  requested_by_customer?: boolean;
  created_at?: string;
}

export interface PdfNegotiationMessage {
  sender_type: string;
  body: string;
  created_at?: string;
}

export interface PdfNegotiationLine {
  product_name: string;
  quantity: number;
  unit_price: number;
  applied_discount_pct: number;
  line_total: number;
}

export interface PdfNegotiationMeta {
  quotation_number: string;
  customer_name?: string | null;
  currency_code: string;
  grand_total?: number | null;
  current_total?: number | null;
  quotation_status: string;
  status: string;
  lines?: PdfNegotiationLine[] | null;
  requests?: PdfNegotiationRequest[] | null;
  messages?: PdfNegotiationMessage[] | null;
}

export function exportNegotiationPdf(neg: PdfNegotiationMeta): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const total = neg.grand_total ?? neg.current_total ?? null;
  let state = addBrandHeader(doc, `Negotiation ${neg.quotation_number}`, neg.status);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  if (neg.customer_name) doc.text(neg.customer_name, MARGIN, state.y);
  state.y += 18;

  const meta: [string, string][] = [
    ["Quotation", neg.quotation_number],
    ["Status", neg.status],
    ["Quote Status", neg.quotation_status],
  ];
  if (neg.customer_name) meta.unshift(["Customer", neg.customer_name]);
  if (total != null) meta.push(["Total", `${neg.currency_code} ${fmtMoney(total)}`]);
  state = metaBlock(state, meta);

  if (neg.lines && neg.lines.length > 0) {
    state = drawTableTo(state, {
      title: "Quotation Lines",
      headers: ["Product", "Qty", "Unit Price", "Discount", "Line Total"],
      rows: neg.lines.map((l) => [
        l.product_name,
        String(l.quantity),
        `${neg.currency_code} ${fmtMoney(l.unit_price)}`,
        `${Number(l.applied_discount_pct).toFixed(2)}%`,
        `${neg.currency_code} ${fmtMoney(l.line_total)}`,
      ]),
      colWidths: [190, 45, 95, 85, 100],
      align: ["left", "center", "right", "right", "right"],
    });
  }

  if (neg.requests && neg.requests.length > 0) {
    state = drawTableTo(state, {
      title: "Negotiation Requests",
      headers: ["Request", "Status", "Original → Requested", "Message"],
      rows: neg.requests.map((r) => [
        r.product_name ? `${r.request_type} · ${r.product_name}` : r.request_type,
        r.status,
        r.original_value != null ? `${r.original_value} → ${r.requested_value}` : r.requested_value,
        r.message || "—",
      ]),
      colWidths: [120, 70, 150, 175],
      align: ["left", "center", "left", "left"],
    });
  }

  if (neg.messages && neg.messages.length > 0) {
    state.y += 6;
    ensureSpace(state, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Discussion", MARGIN, state.y + 12);
    state.y += 24;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    neg.messages.forEach((m) => {
      const label = `${m.sender_type === "SALES" ? "RevSync Sales" : "Customer"} · ${fmtDate(m.created_at)}`;
      ensureSpace(state, 24);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(100, 116, 139);
      doc.text(label, MARGIN, state.y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 65, 85);
      const wrapped = doc.splitTextToSize(m.body, CONTENT_WIDTH);
      doc.text(wrapped, MARGIN, state.y + 12);
      state.y += 12 + wrapped.length * 11 + 10;
    });
  }

  finishDoc(doc, `revsync-negotiation-${neg.quotation_number}.pdf`, `Negotiation ${neg.quotation_number} · ${neg.customer_name || "RevSync"}`);
}

export interface PdfApprovalStep {
  sequence: number;
  role_name: string;
  status: string;
  decided_by_name?: string | null;
  decided_at?: string | null;
  notes?: string | null;
}

export interface PdfApproval {
  id: number;
  quotation_number: string;
  customer_name: string;
  currency_code: string;
  grand_total: number;
  status: string;
  risk_level: string;
  total_overage: number;
  submitted_by_name: string;
  submitted_at?: string;
  decided_by_name?: string | null;
  decided_at?: string | null;
  notes?: string | null;
  steps: PdfApprovalStep[];
}

export function exportApprovalPdf(approval: PdfApproval): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let state = addBrandHeader(
    doc,
    `Approval AR-${String(approval.id).padStart(4, "0")}`,
    `${approval.risk_level} RISK`
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(approval.customer_name, MARGIN, state.y);
  state.y += 18;

  state = metaBlock(state, [
    ["Reference", `AR-${String(approval.id).padStart(4, "0")}`],
    ["Quotation", approval.quotation_number],
    ["Status", approval.status],
    ["Risk Level", approval.risk_level],
    ["Grand Total", `${approval.currency_code} ${fmtMoney(approval.grand_total)}`],
    ["Discount Overage", `${Number(approval.total_overage).toFixed(1)} pts`],
    ["Submitted By", approval.submitted_by_name],
    ["Submitted At", fmtDate(approval.submitted_at)],
    ["Decided By", approval.decided_by_name || "—"],
    ["Decided At", approval.decided_at ? fmtDate(approval.decided_at) : "—"],
  ]);

  state = drawTableTo(state, {
    title: "Approval Chain",
    headers: ["Step", "Role", "Status", "Decided By", "Date", "Notes"],
    rows: approval.steps.map((s) => [
      `#${s.sequence}`,
      s.role_name,
      s.status,
      s.decided_by_name || "—",
      s.decided_at ? fmtDate(s.decided_at) : "—",
      s.notes || "—",
    ]),
    colWidths: [45, 90, 95, 90, 70, 125],
    align: ["center", "left", "center", "left", "left", "left"],
  });

  if (approval.notes) {
    state.y += 6;
    ensureSpace(state, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text("Submission Notes", MARGIN, state.y);
    state.y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(doc.splitTextToSize(approval.notes, CONTENT_WIDTH), MARGIN, state.y);
  }

  finishDoc(doc, `revsync-approval-AR-${String(approval.id).padStart(4, "0")}.pdf`, `Approval for ${approval.customer_name} · ${approval.quotation_number}`);
}

// Re-exported engine helpers so the module stays self-contained.
function drawTableTo(state: DrawState, opts: PdfTableOptions): DrawState {
  drawTable(state, opts);
  return state;
}

export { ensureSpace };