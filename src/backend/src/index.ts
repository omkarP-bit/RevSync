import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { v4 as uuidv4 } from "uuid";
import { loadConfig } from "./config.js";
import { getPool } from "./database/pool.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { getLogger } from "./shared/logger.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { customersRouter } from "./modules/customers/customers.routes.js";
import { categoriesRouter } from "./modules/categories/categories.routes.js";
import { currenciesRouter } from "./modules/currencies/currencies.routes.js";
import { productsRouter } from "./modules/products/products.routes.js";
import { pricingRouter } from "./modules/pricing/pricing.routes.js";
import { quotationsRouter } from "./modules/quotations/quotations.routes.js";
import { discountsRouter } from "./modules/discounts/discounts.routes.js";
import { approvalsRouter } from "./modules/approvals/approvals.routes.js";
import { warehousesRouter, fulfillmentRouter } from "./modules/fulfillment/fulfillment.routes.js";
import { negotiationsRouter, negotiationsPortalRouter } from "./modules/negotiations/negotiations.routes.js";
import { invoicesRouter, creditNotesRouter, invoicesPortalRouter } from "./modules/billing/billing.routes.js";
import { subscriptionsRouter } from "./modules/subscriptions/subscriptions.routes.js";
import { subscriptionsPortalRouter, walletPortalRouter } from "./modules/subscriptions/subscriptionsPortal.routes.js";
import { dealHealthRouter } from "./modules/deal-health/deal-health.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";

import { customerAuthRouter } from "./modules/auth/customerAuth.routes.js";
import { quotationsPortalRouter, portalDashboardRouter } from "./modules/quotations/quotationsPortal.routes.js";

async function main() {
  const config = loadConfig();
  const logger = getLogger();
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use((req, _res, next) => { (req as any).id = uuidv4(); next(); });
  app.use(express.json());
  app.use(requestLogger);

  // Test DB connection & ensure schema constraints
  try {
    await getPool().query("SELECT 1");
    await getPool().query("ALTER TABLE invoices ALTER COLUMN quotation_id DROP NOT NULL").catch(() => {});
    await getPool().query("ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_payment_method_check").catch(() => {});
    await getPool().query("ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_payment_method_check CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'CARD', 'CHECK', 'CREDIT_WALLET', 'OTHER'))").catch(() => {});
    logger.info("Database connected");
  } catch (err) {
    logger.error("Database connection failed");
    process.exit(1);
  }

  // Routes
  app.use("/api/v1", healthRouter);
  app.use("/api/v1/auth/customer", customerAuthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/customers", customersRouter);
  app.use("/api/v1/categories", categoriesRouter);
  app.use("/api/v1/currencies", currenciesRouter);
  app.use("/api/v1/products", productsRouter);
  app.use("/api/v1/pricelists", pricingRouter);
  app.use("/api/v1/quotations", quotationsRouter);
  app.use("/api/v1/discounts", discountsRouter);
  app.use("/api/v1/approvals", approvalsRouter);
  app.use("/api/v1/warehouses", warehousesRouter);
  app.use("/api/v1/fulfillment", fulfillmentRouter);
  app.use("/api/v1/negotiations", negotiationsRouter);
  app.use("/api/v1/invoices", invoicesRouter);
  app.use("/api/v1/credit-notes", creditNotesRouter);
  app.use("/api/v1/subscriptions", subscriptionsRouter);
  app.use("/api/v1/deal-health", dealHealthRouter);
  app.use("/api/v1/reports", reportsRouter);
  app.use("/api/v1/portal/dashboard", portalDashboardRouter);
  app.use("/api/v1/portal/quotations", quotationsPortalRouter);
  app.use("/api/v1/portal/negotiations", negotiationsPortalRouter);
  app.use("/api/v1/portal/invoices", invoicesPortalRouter);
  app.use("/api/v1/portal/subscriptions", subscriptionsPortalRouter);
  app.use("/api/v1/portal/wallet", walletPortalRouter);

  app.use(errorHandler);

  app.listen(config.PORT, () => {
    logger.info(`RevSync backend running on port ${config.PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error", err);
  process.exit(1);
});
