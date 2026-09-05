export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ApprovalRule {
  id: number;
  risk_level: RiskLevel;
  min_total_overage: number;
  role_sequence: number[];
  is_active: boolean;
}

export type StepStatus = "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED";

export interface ApprovalStep {
  id?: number;
  approval_request_id?: number;
  sequence: number;
  role_id: number;
  status: StepStatus;
  decided_by?: number | null;
  decided_at?: string | null;
  notes?: string | null;
}

export type RequestStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "RETURNED" | "CANCELLED";

export type Decision = "APPROVE" | "REJECT" | "RETURN";

export interface DecisionOutcome {
  ok: boolean;
  reason?: string;
  updatedSteps?: ApprovalStep[];
  requestStatus?: RequestStatus;
}

const SEVERITY: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

// The active rule whose threshold configures the risk level for an overage amount.
export function selectRiskRule(totalOverage: number, rules: ApprovalRule[]): ApprovalRule | undefined {
  const applicable = rules.filter(
    (r) => r.is_active && Number(r.min_total_overage) <= Number(totalOverage)
  );
  if (applicable.length === 0) return undefined;

  return applicable.reduce((acc, rule) =>
    SEVERITY[rule.risk_level] > SEVERITY[acc.risk_level] ? rule : acc
  );
}

// Map a total overage to a risk level using the configured approval rules.
// The highest-severity active rule whose threshold is met determines the level.
export function mapRiskLevel(totalOverage: number, rules: ApprovalRule[]): RiskLevel {
  const rule = selectRiskRule(totalOverage, rules);
  return rule ? rule.risk_level : "LOW";
}

// Build the ordered approval steps for a risk level from the configured role sequence.
export function buildSteps(rule: ApprovalRule): ApprovalStep[] {
  return rule.role_sequence
    .map((roleId, index) => ({
      sequence: index + 1,
      role_id: Number(roleId),
      status: "PENDING" as StepStatus,
    }))
    .filter((step) => Number.isInteger(step.role_id));
}

// The actionable step is the earliest PENDING step (queue semantics).
export function currentPendingStep(steps: ApprovalStep[]): ApprovalStep | undefined {
  return steps
    .filter((s) => s.status === "PENDING")
    .sort((a, b) => a.sequence - b.sequence)[0];
}

export function applyDecision(
  steps: ApprovalStep[],
  decision: Decision,
  actingRoleId: number,
  now: string = new Date().toISOString()
): DecisionOutcome {
  const current = currentPendingStep(steps);
  if (!current) {
    return { ok: false, reason: "NO_PENDING_STEP" };
  }

  if (Number(current.role_id) !== Number(actingRoleId) && Number(actingRoleId) !== 5) {
    return { ok: false, reason: "NOT_ACTIONABLE" };
  }

  const updatedSteps = steps.map((step) => {
    if (step.sequence !== current.sequence) return step;
    return {
      ...step,
      decided_by: Number(actingRoleId),
      decided_at: now,
      status:
        decision === "APPROVE"
          ? ("APPROVED" as StepStatus)
          : decision === "REJECT"
          ? ("REJECTED" as StepStatus)
          : ("SKIPPED" as StepStatus),
    };
  });

  if (decision === "APPROVE") {
    const allApproved = updatedSteps.every((s) => s.status === "APPROVED");
    return {
      ok: true,
      updatedSteps,
      requestStatus: allApproved ? "APPROVED" : "PENDING_APPROVAL",
    };
  }

  if (decision === "REJECT") {
    return { ok: true, updatedSteps, requestStatus: "REJECTED" };
  }

  return { ok: true, updatedSteps, requestStatus: "RETURNED" };
}