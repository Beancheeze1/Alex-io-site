// lib/env.ts
import { z } from "zod";

// Define schema for required environment variables
const EnvSchema = z.object({
  ADMIN_KEY: z.string().min(1, "ADMIN_KEY is required"),
  HUBSPOT_CLIENT_ID: z.string().optional(),
  HUBSPOT_CLIENT_SECRET: z.string().optional(),
  HUBSPOT_REDIRECT_URI: z.string().optional(),
  HUBSPOT_WEBHOOK_SECRET: z.string().optional(),
  HUBSPOT_VALIDATE_WEBHOOKS: z
    .string()
    .optional()
    .transform(v => v === "true"),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);

export function requireEnv() {
  EnvSchema.parse(process.env);
  return process.env;
}
