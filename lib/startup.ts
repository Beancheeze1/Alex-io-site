// lib/startup.ts
import { validateEnv } from "./env";
import logger from "./logger";

export function initializeApp() {
  // Skip during Next.js build phase (critical for /_not-found route)
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  try {
    validateEnv();
    logger.info("🚀 Alex-IO application initialized successfully");
    logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
  } catch (err) {
    logger.error("❌ Critical startup failure", { error: err });
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  }
}