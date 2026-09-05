export type DealHealthStatus = "HEALTHY" | "AT_RISK" | "CRITICAL";

export type DealSignalKey =
  | "STALLED_QUOTE"
  | "APPROVAL_DELAY"
  | "INVENTORY_SHORTAGE"
  | "HIGH_DISCOUNT_RISK"
  | "NEGOTIATION_STALL";

export interface SignalConfig {
  key: DealSignalKey;
  weight: number;
  enabled: boolean;
}

export interface DealHealthInput {
  quotationStatus: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  marginPct: number;
  lastUpdatedAt: Date;
  pendingApprovalSince: Date | null;
  backorderedQuantity: number;
  requestedQuantity: number;
  openNegotiationSince: Date | null;
  now: Date;
}

export interface SignalResult {
  key: DealSignalKey;
  label: string;
  weight: number;
  enabled: boolean;
  severity: number;
  contribution: number;
  reason: string;
}

export interface DealHealthResult {
  score: number;
  status: DealHealthStatus;
  signals: SignalResult[];
}

export const DEAL_HEALTH_SIGNALS: { key: DealSignalKey; label: string; description: string }[] = [
  {
    key: "STALLED_QUOTE",
    label: "Stalled quote",
    description: "Quotation has not been updated for several days while still in an open status.",
  },
  {
    key: "APPROVAL_DELAY",
    label: "Approval delay",
    description: "A pending approval request on the quotation has been waiting for several days.",
  },
  {
    key: "INVENTORY_SHORTAGE",
    label: "Inventory shortage",
    description: "A confirmed quotation has a fulfillment order with backorders or partial allocation.",
  },
  {
    key: "HIGH_DISCOUNT_RISK",
    label: "High discount risk",
    description: "Quotation risk level is HIGH or margin is below the healthy floor.",
  },
  {
    key: "NEGOTIATION_STALL",
    label: "Negotiation stall",
    description: "An open negotiation channel has not progressed for several days.",
  },
];

const OPEN_QUOTATION_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "NEGOTIATION",
  "PENDING_REAPPROVAL",
] as const;

const STALL_TOLERANCE_DAYS = 3;
const STALL_SEVERE_DAYS = 15;
const APPROVAL_TOLERANCE_DAYS = 2;
const APPROVAL_SEVERE_DAYS = 7;
const NEGOTIATION_TOLERANCE_DAYS = 3;
const NEGOTIATION_SEVERE_DAYS = 10;
const MARGIN_HEALTHY_FLOOR_PCT = 15;
const MARGIN_LOW_FLOOR_PCT = 10;

const HEALTHY_SCORE_MAX = 30;
const AT_RISK_SCORE_MAX = 70;

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
}

function ramp(days: number, tolerance: number, severe: number): number {
  if (days <= tolerance) return 0;
  return Math.min(1, (days - tolerance) / Math.max(1, severe - tolerance));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Deterministic, explainable deal health scoring. Each signal is assigned a
// severity in [0, 1] and weighted by the configured signal weight; the total
// score is normalized to 0-100 by the sum of enabled weights.
export function evaluateDealHealth(input: DealHealthInput, configs: SignalConfig[]): DealHealthResult {
  const weightByKey = new Map<string, number>();
  for (const cfg of configs) {
    weightByKey.set(cfg.key, Number(cfg.weight));
  }
  const enabledWeightByKey = new Map<string, number>();
  for (const cfg of configs) {
    if (cfg.enabled) {
      enabledWeightByKey.set(cfg.key, Number(cfg.weight));
    }
  }

  const signalResults: SignalResult[] = [];
  const labels = new Map(DEAL_HEALTH_SIGNALS.map((s) => [s.key, s.label]));

  const isOpen = (OPEN_QUOTATION_STATUSES as readonly string[]).includes(input.quotationStatus);
  const stallDays = input.lastUpdatedAt ? daysBetween(input.lastUpdatedAt, input.now) : 0;

  const stallSeverity = isOpen ? ramp(stallDays, STALL_TOLERANCE_DAYS, STALL_SEVERE_DAYS) : 0;
  signalResults.push({
    key: "STALLED_QUOTE",
    label: labels.get("STALLED_QUOTE")!,
    weight: Number(weightByKey.get("STALLED_QUOTE") ?? 0),
    enabled: enabledWeightByKey.has("STALLED_QUOTE"),
    severity: round2(stallSeverity),
    contribution: round2((enabledWeightByKey.get("STALLED_QUOTE") ?? 0) * stallSeverity),
    reason: isOpen
      ? `Quotation is ${input.quotationStatus.replace("_", " ")} and has not been updated in ${stallDays} day(s).`
      : `Quotation status ${input.quotationStatus} is terminal; no stall signal.`,
  });

  const approvalSeverity = input.pendingApprovalSince
    ? ramp(daysBetween(input.pendingApprovalSince, input.now), APPROVAL_TOLERANCE_DAYS, APPROVAL_SEVERE_DAYS)
    : 0;
  signalResults.push({
    key: "APPROVAL_DELAY",
    label: labels.get("APPROVAL_DELAY")!,
    weight: Number(weightByKey.get("APPROVAL_DELAY") ?? 0),
    enabled: enabledWeightByKey.has("APPROVAL_DELAY"),
    severity: round2(approvalSeverity),
    contribution: round2((enabledWeightByKey.get("APPROVAL_DELAY") ?? 0) * approvalSeverity),
    reason: input.pendingApprovalSince
      ? `A pending approval has been waiting ${daysBetween(input.pendingApprovalSince, input.now)} day(s).`
      : "No pending approval request.",
  });

  const requested = Number(input.requestedQuantity);
  const backordered = Number(input.backorderedQuantity);
  const shortageSeverity = requested > 0 ? Math.min(1, backordered / requested) : 0;
  signalResults.push({
    key: "INVENTORY_SHORTAGE",
    label: labels.get("INVENTORY_SHORTAGE")!,
    weight: Number(weightByKey.get("INVENTORY_SHORTAGE") ?? 0),
    enabled: enabledWeightByKey.has("INVENTORY_SHORTAGE"),
    severity: round2(shortageSeverity),
    contribution: round2((enabledWeightByKey.get("INVENTORY_SHORTAGE") ?? 0) * shortageSeverity),
    reason:
      requested > 0 && backordered > 0
        ? `${backordered} of ${requested} requested unit(s) are backordered.`
        : "All requested units are allocated from inventory.",
  });

  const riskSeverity = input.riskLevel === "HIGH" ? 1 : input.riskLevel === "MEDIUM" ? 0.5 : 0;
  const margin = Number(input.marginPct);
  const marginSeverity =
    margin < MARGIN_LOW_FLOOR_PCT ? 0.75 : margin < MARGIN_HEALTHY_FLOOR_PCT ? 0.5 : 0;
  const riskSignalSeverity = Math.max(riskSeverity, marginSeverity);
  signalResults.push({
    key: "HIGH_DISCOUNT_RISK",
    label: labels.get("HIGH_DISCOUNT_RISK")!,
    weight: Number(weightByKey.get("HIGH_DISCOUNT_RISK") ?? 0),
    enabled: enabledWeightByKey.has("HIGH_DISCOUNT_RISK"),
    severity: round2(riskSignalSeverity),
    contribution: round2((enabledWeightByKey.get("HIGH_DISCOUNT_RISK") ?? 0) * riskSignalSeverity),
    reason:
      riskSeverity > marginSeverity
        ? `Quotation carries ${input.riskLevel} discount risk.`
        : `Quotation margin ${margin.toFixed(2)}% is below the healthy floor (${MARGIN_HEALTHY_FLOOR_PCT}%).`,
  });

  const negotiationSeverity = input.openNegotiationSince
    ? ramp(daysBetween(input.openNegotiationSince, input.now), NEGOTIATION_TOLERANCE_DAYS, NEGOTIATION_SEVERE_DAYS)
    : 0;
  signalResults.push({
    key: "NEGOTIATION_STALL",
    label: labels.get("NEGOTIATION_STALL")!,
    weight: Number(weightByKey.get("NEGOTIATION_STALL") ?? 0),
    enabled: enabledWeightByKey.has("NEGOTIATION_STALL"),
    severity: round2(negotiationSeverity),
    contribution: round2((enabledWeightByKey.get("NEGOTIATION_STALL") ?? 0) * negotiationSeverity),
    reason: input.openNegotiationSince
      ? `An open negotiation has not progressed in ${daysBetween(input.openNegotiationSince, input.now)} day(s).`
      : "No open negotiation channel.",
  });

  const enabledWeightTotal = signalResults
    .filter((s) => s.enabled)
    .reduce((sum, s) => sum + Number(s.weight), 0);
  const weightedScore = signalResults
    .filter((s) => s.enabled)
    .reduce((sum, s) => sum + Number(s.contribution), 0);
  const score =
    enabledWeightTotal > 0
      ? round2((weightedScore / enabledWeightTotal) * 100)
      : 0;

  const status: DealHealthStatus =
    score < HEALTHY_SCORE_MAX ? "HEALTHY" : score < AT_RISK_SCORE_MAX ? "AT_RISK" : "CRITICAL";

  return { score, status, signals: signalResults };
}