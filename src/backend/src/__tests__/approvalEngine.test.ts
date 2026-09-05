import { describe, it, expect } from "vitest";
import {
  mapRiskLevel,
  selectRiskRule,
  buildSteps,
  currentPendingStep,
  applyDecision,
  ApprovalRule,
  ApprovalStep,
} from "../engines/approval-engine.js";

const rules: ApprovalRule[] = [
  { id: 1, risk_level: "MEDIUM", min_total_overage: 5, role_sequence: [2], is_active: true },
  { id: 2, risk_level: "HIGH", min_total_overage: 8, role_sequence: [2, 3], is_active: true },
];

describe("Approval Engine - risk mapping", () => {
  it("maps zero/small overage to LOW when no threshold is met", () => {
    expect(mapRiskLevel(0, rules)).toBe("LOW");
    expect(mapRiskLevel(4.99, rules)).toBe("LOW");
  });

  it("maps an overage to MEDIUM when only the MEDIUM threshold is met", () => {
    expect(mapRiskLevel(6, rules)).toBe("MEDIUM");
  });

  it("maps an overage to the highest severity rule whose threshold is met", () => {
    expect(mapRiskLevel(8, rules)).toBe("HIGH");
    expect(mapRiskLevel(30, rules)).toBe("HIGH");
  });

  it("selects the governing rule for step building", () => {
    expect(selectRiskRule(8, rules)?.id).toBe(2);
    expect(selectRiskRule(6, rules)?.id).toBe(1);
    expect(selectRiskRule(3, rules)).toBeUndefined();
  });

  it("ignores inactive rules", () => {
    const inactive: ApprovalRule[] = [
      { id: 1, risk_level: "HIGH", min_total_overage: 1, role_sequence: [2], is_active: false },
    ];
    expect(mapRiskLevel(50, inactive)).toBe("LOW");
  });
});

describe("Approval Engine - steps", () => {
  it("builds ordered steps from a role sequence", () => {
    const steps = buildSteps(rules[1]); // HIGH -> [2, 3]
    expect(steps).toEqual([
      { sequence: 1, role_id: 2, status: "PENDING" },
      { sequence: 2, role_id: 3, status: "PENDING" },
    ]);
  });

  it("returns the earliest pending step as the actionable one", () => {
    const steps: ApprovalStep[] = [
      { sequence: 1, role_id: 2, status: "PENDING" },
      { sequence: 2, role_id: 3, status: "PENDING" },
    ];
    expect(currentPendingStep(steps)?.role_id).toBe(2);
  });

  it("skips already-decided steps when finding the actionable step", () => {
    const steps: ApprovalStep[] = [
      { sequence: 1, role_id: 2, status: "APPROVED" },
      { sequence: 2, role_id: 3, status: "PENDING" },
    ];
    expect(currentPendingStep(steps)?.role_id).toBe(3);
  });
});

describe("Approval Engine - decisions", () => {
  const step = (sequence: number, roleId: number, status: ApprovalStep["status"] = "PENDING") => ({
    id: sequence,
    sequence,
    role_id: roleId,
    status,
  });

  it("advances the current step on approve but stays pending until all steps approve", () => {
    const outcome = applyDecision([step(1, 2), step(2, 3)], "APPROVE", 2);
    expect(outcome.ok).toBe(true);
    expect(outcome.requestStatus).toBe("PENDING_APPROVAL");
    expect(outcome.updatedSteps?.[0].status).toBe("APPROVED");
    expect(outcome.updatedSteps?.[1].status).toBe("PENDING");
  });

  it("completes the workflow when the final step approves", () => {
    const steps = [step(1, 2, "APPROVED"), step(2, 3)];
    const outcome = applyDecision(steps, "APPROVE", 3);
    expect(outcome.requestStatus).toBe("APPROVED");
    expect(outcome.updatedSteps?.[1].status).toBe("APPROVED");
  });

  it("rejects when a non-current role tries to decide", () => {
    const outcome = applyDecision([step(1, 2), step(2, 3)], "APPROVE", 3);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("NOT_ACTIONABLE");
  });

  it("rejects the whole request on a reject decision", () => {
    const outcome = applyDecision([step(1, 2), step(2, 3)], "REJECT", 2);
    expect(outcome.requestStatus).toBe("REJECTED");
    expect(outcome.updatedSteps?.[0].status).toBe("REJECTED");
  });

  it("returns the request on a return decision", () => {
    const outcome = applyDecision([step(1, 2)], "RETURN", 2);
    expect(outcome.requestStatus).toBe("RETURNED");
    expect(outcome.updatedSteps?.[0].status).toBe("SKIPPED");
  });

  it("errors when there is no pending step", () => {
    const outcome = applyDecision([step(1, 2, "APPROVED")], "APPROVE", 2);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("NO_PENDING_STEP");
  });
});