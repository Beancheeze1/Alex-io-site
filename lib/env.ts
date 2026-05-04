// lib/env.ts
import { z } from "zod";

/**
 * Production-grade environment validation
 * - NEXTAUTH_SECRET is required in real runtime, but optional during build
 * - All other critical vars are enforced
 */
const EnvSchema = z
  .object({
    // === REQUIRED for production ===
    DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL URL"),

    // AUTH_SECRET is the actual HMAC signing key used by lib/auth.ts
    AUTH_SECRET: z
      .string()
      .min(32, "AUTH_SECRET must be at least 32 characters (use: openssl rand -hex 32)")
      .optional()
      .refine((val) => {
        if (process.env.NEXT_PHASE === "phase-production-build") return true;
        return val && val.length >= 32;
      }, "AUTH_SECRET is required in production (min 32 chars)"),

    // NEXTAUTH_SECRET kept as optional for any legacy references
    NEXTAUTH_SECRET: z.string().optional(),

    ADMIN_KEY: z.string().min(1, "ADMIN_KEY is required"),

    // === HubSpot Integration ===
    HUBSPOT_CLIENT_ID: z.string().optional(),
    HUBSPOT_CLIENT_SECRET: z.string().optional(),
    HUBSPOT_REDIRECT_URI: z.string().optional(),
    HUBSPOT_WEBHOOK_SECRET: z.string().optional(),
    HUBSPOT_ACCESS_TOKEN: z.string().optional(),
    HUBSPOT_VALIDATE_WEBHOOKS: z
      .string()
      .optional()
      .transform((v) => v === "true"),

    // === Microsoft Graph (Email) ===
    MICROSOFT_GRAPH_CLIENT_ID: z.string().optional(),
    MICROSOFT_GRAPH_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_GRAPH_TENANT_ID: z.string().optional(),
    MICROSOFT_GRAPH_MAILBOX: z.string().email().optional(),

    // === Redis (Upstash) ===
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

    // === Optional / Development ===
    NEXTAUTH_URL: z.string().url().optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  })
  .passthrough();

export const env = EnvSchema.parse(process.env);

export function validateEnv(): void {
  try {
    EnvSchema.parse(process.env);
    console.log("✅ Environment variables validated successfully");
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Environment validation failed:");
      error.issues.forEach((issue) => {
        console.error(`   • ${issue.path.join(".")}: ${issue.message}`);
      });
      console.error("\nPlease check your .env file and restart the server.");
    } else {
      console.error("❌ Unexpected error validating environment:", error);
    }
    process.exit(1);
  }
}

export function requireEnv() {
  validateEnv();
  return process.env;
}