import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ForbiddenError, UnprocessableEntityError, ValidationError } from "../../shared/errors.js";
import { writeAuditLog } from "../../shared/audit.js";
import { applyDecision, Decision, RiskLevel } from "../../engines/approval-engine.js";
import { z } from "zod";

export const approvalsRouter = Router();
approvalsRouter.use(authenticate);

const approvalRuleSchema = z.object({
  risk_level: z.enum(["LOW", "MEDIUM", "HIGH"]),
  min_total_overage: z.number().nonnegative(),
  role_sequence: z.array(z.number().int().positive()).min(1),
  is_active: z.boolean().default(true),
});

const decisionSchema = z.object({
  notes: z.string().optional(),
});

// GET /api/v1/approvals
approvalsRouter.get("/", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.status) {
      where.push(`ar.status = $${paramIdx++}`);
      params.push(req.query.status);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM approval_requests ar ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT ar.id, ar.quotation_id, q.quotation_number, c.name as customer_name,
              ar.status, ar.risk_level, ar.total_overage, ar.submitted_by,
              su.first_name || ' ' || su.last_name as submitted_by_name,
              ar.submitted_at, ar.decided_by,
              du.first_name || ' ' || du.last_name as decided_by_name,
              ar.decided_at, ar.notes, q.currency_code, q.grand_total
       FROM approval_requests ar
       JOIN quotations q ON ar.quotation_id = q.id
       JOIN customers c ON q.customer_id = c.id
       JOIN users su ON ar.submitted_by = su.id
       LEFT JOIN users du ON ar.decided_by = du.id
       ${whereClause}
       ORDER BY ar.created_at ASC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    // Resolve the first pending step info per request
    const data: any[] = [];
    for (const row of result.rows) {
      const stepRes = await query(
        `SELECT s.sequence, s.role_id, r.name as role_name, s.status
         FROM approval_steps s
         JOIN roles r ON s.role_id = r.id
         WHERE s.approval_request_id = $1 AND s.status = 'PENDING'
         ORDER BY s.sequence ASC
         LIMIT 1`,
        [row.id]
      );
      data.push({
        ...row,
        id: Number(row.id),
        quotation_id: Number(row.quotation_id),
        total_overage: Number(row.total_overage),
        grand_total: Number(row.grand_total),
        current_step: stepRes.rows.length > 0 ? {
          sequence: Number(stepRes.rows[0].sequence),
          role_id: Number(stepRes.rows[0].role_id),
          role_name: stepRes.rows[0].role_name,
        } : null,
      });
    }

    res.json({
      data,
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/approvals/rules
approvalsRouter.get("/rules", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query(
      `SELECT id, risk_level, min_total_overage, role_sequence, is_active, created_at, updated_at
       FROM approval_rules
       ORDER BY risk_level ASC, min_total_overage ASC`
    );
    res.json({
      data: result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        min_total_overage: Number(row.min_total_overage),
        role_sequence: row.role_sequence.map(Number),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/approvals/:id
approvalsRouter.get("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const requestResult = await query(
      `SELECT ar.id, ar.quotation_id, q.quotation_number, c.name as customer_name,
              q.currency_code, q.grand_total, ar.status, ar.risk_level, ar.total_overage,
              ar.submitted_by, su.first_name || ' ' || su.last_name as submitted_by_name,
              ar.submitted_at, ar.decided_by,
              du.first_name || ' ' || du.last_name as decided_by_name,
              ar.decided_at, ar.notes
       FROM approval_requests ar
       JOIN quotations q ON ar.quotation_id = q.id
       JOIN customers c ON q.customer_id = c.id
       JOIN users su ON ar.submitted_by = su.id
       LEFT JOIN users du ON ar.decided_by = du.id
       WHERE ar.id = $1`,
      [id]
    );

    if (requestResult.rows.length === 0) {
      throw new NotFoundError("Approval request", id);
    }

    const request = requestResult.rows[0];

    const stepsResult = await query(
      `SELECT s.id, s.sequence, s.role_id, r.name as role_name, s.status,
              s.decided_by, du.first_name || ' ' || du.last_name as decided_by_name,
              s.decided_at, s.notes
       FROM approval_steps s
       JOIN roles r ON s.role_id = r.id
       LEFT JOIN users du ON s.decided_by = du.id
       WHERE s.approval_request_id = $1
       ORDER BY s.sequence ASC`,
      [id]
    );

    res.json({
      data: {
        ...request,
        id: Number(request.id),
        quotation_id: Number(request.quotation_id),
        grand_total: Number(request.grand_total),
        total_overage: Number(request.total_overage),
        steps: stepsResult.rows.map((step) => ({
          ...step,
          id: Number(step.id),
          sequence: Number(step.sequence),
          role_id: Number(step.role_id),
          decided_by: step.decided_by ? Number(step.decided_by) : null,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/approvals/rules (Admin only)
approvalsRouter.post("/rules", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = approvalRuleSchema.parse(req.body);
    const userId = (req as any).user.userId;

    const result = await query(
      `INSERT INTO approval_rules (risk_level, min_total_overage, role_sequence, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.risk_level, data.min_total_overage, data.role_sequence, data.is_active]
    );

    const row = result.rows[0];
    await writeAuditLog({
      entityType: "approval_rules",
      entityId: row.id,
      action: "RULE_CREATED",
      before: null,
      after: {
        risk_level: row.risk_level,
        min_total_overage: Number(row.min_total_overage),
        role_sequence: row.role_sequence.map(Number),
        is_active: row.is_active,
      },
      performedBy: userId,
      reason: `Approval rule for ${row.risk_level} risk configured`,
    });

    res.status(201).json({
      data: {
        ...row,
        id: Number(row.id),
        min_total_overage: Number(row.min_total_overage),
        role_sequence: row.role_sequence.map(Number),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/approvals/rules/:id (Admin only)
approvalsRouter.patch("/rules/:id", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const fields = approvalRuleSchema.partial().parse(req.body);
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);

    if (entries.length === 0) {
      throw new ValidationError("No fields to update");
    }

    const before = await query(`SELECT * FROM approval_rules WHERE id = $1`, [id]);
    if (before.rows.length === 0) {
      throw new NotFoundError("Approval rule", id);
    }

    const setClauses = entries.map(([key], i) => `${key} = $${i + 1}`);
    const values = entries.map(([, v]) => v);

    const result = await query(
      `UPDATE approval_rules SET ${setClauses.join(", ")}, updated_at = NOW()
       WHERE id = $${entries.length + 1}
       RETURNING *`,
      [...values, id]
    );

    const row = result.rows[0];
    await writeAuditLog({
      entityType: "approval_rules",
      entityId: row.id,
      action: "RULE_UPDATED",
      before: before.rows[0],
      after: row,
      performedBy: userId,
      reason: "Approval rule updated",
    });

    res.json({
      data: {
        ...row,
        id: Number(row.id),
        min_total_overage: Number(row.min_total_overage),
        role_sequence: row.role_sequence.map(Number),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/approvals/:id/approve|reject|return
function decisionHandler(decision: Decision) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.userId;
      const userRoleId = Number((req as any).user.roleId);
      const { notes } = decisionSchema.parse(req.body ?? {});

      const requestResult = await query(
        `SELECT id, quotation_id, status, risk_level FROM approval_requests WHERE id = $1`,
        [id]
      );
      if (requestResult.rows.length === 0) {
        throw new NotFoundError("Approval request", id);
      }
      const request = requestResult.rows[0];

      if (request.status !== "PENDING_APPROVAL") {
        throw new UnprocessableEntityError("This approval request has already been decided");
      }

      const stepsResult = await query(
        `SELECT id, sequence, role_id, status FROM approval_steps
         WHERE approval_request_id = $1
         ORDER BY sequence ASC`,
        [id]
      );

      const steps = stepsResult.rows.map((s) => ({
        id: Number(s.id),
        sequence: Number(s.sequence),
        role_id: Number(s.role_id),
        status: s.status,
      }));

      const outcome = applyDecision(steps, decision, userRoleId);
      if (!outcome.ok) {
        if (outcome.reason === "NOT_ACTIONABLE") {
          throw new ForbiddenError("This step can only be decided by the required role");
        }
        throw new UnprocessableEntityError("No pending step is available on this approval request");
      }

      const beforeStatus = { request_status: request.status, steps: steps.map((s) => s.status) };

      for (const step of outcome.updatedSteps || []) {
        const before = steps.find((s) => Number(s.id) === Number(step.id));
        if (before && before.status === step.status) continue;
        await query(
          `UPDATE approval_steps SET
             status = $1, decided_by = $2, decided_at = $3, notes = $4
           WHERE id = $5`,
          [step.status, userId, step.decided_at, notes ?? null, step.id]
        );
      }

      await query(
        `UPDATE approval_requests SET
           status = $1, decided_by = $2, decided_at = $3, notes = COALESCE($4, notes)
         WHERE id = $5`,
        [outcome.requestStatus, userId, new Date().toISOString(), notes ?? null, id]
      );

      const quotationStatus =
        outcome.requestStatus === "APPROVED"
          ? "APPROVED"
          : outcome.requestStatus === "REJECTED"
          ? "REJECTED"
          : outcome.requestStatus === "RETURNED"
          ? "NEGOTIATION"
          : null;

      if (quotationStatus) {
        await query(
          `UPDATE quotations SET status = $1, updated_at = NOW() WHERE id = $2`,
          [quotationStatus, request.quotation_id]
        );
      }

      const after = {
        request_status: outcome.requestStatus,
        quotation_status: quotationStatus,
        steps: (outcome.updatedSteps || []).map((s) => s.status),
      };

      await writeAuditLog({
        entityType: "approval_requests",
        entityId: id,
        action: `DECISION_${decision}`,
        before: { ...beforeStatus, risk_level: request.risk_level },
        after,
        performedBy: userId,
        reason: notes || `${decision} by role ${userRoleId}`,
      });

      const decidedAt = new Date().toISOString();

      res.json({
        data: {
          id: Number(id),
          status: outcome.requestStatus,
          quotation_status: quotationStatus,
          steps: (outcome.updatedSteps || []).map((s) => ({
            id: s.id,
            sequence: s.sequence,
            role_id: s.role_id,
            status: s.status,
            decided_by: s.decided_by,
            decided_at: s.decided_at,
          })),
          decided_at: decidedAt,
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

approvalsRouter.post("/:id/approve", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER, ROLES.FINANCE), decisionHandler("APPROVE"));
approvalsRouter.post("/:id/reject", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER, ROLES.FINANCE), decisionHandler("REJECT"));
approvalsRouter.post("/:id/return", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER, ROLES.FINANCE), decisionHandler("RETURN"));