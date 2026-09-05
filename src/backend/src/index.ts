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

  // Test DB connection
  try {
    await getPool().query("SELECT 1");
    logger.info("Database connected");
  } catch (err) {
    logger.error("Database connection failed");
    process.exit(1);
  }

  // Routes
  app.use("/api/v1", healthRouter);
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
  app.use("/api/v1/portal/negotiations", negotiationsPortalRouter);

  app.use(errorHandler);

  app.listen(config.PORT, () => {
    logger.info(`RevSync backend running on port ${config.PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error", err);
  process.exit(1);
});
