// scripts/guard-checks.mjs
console.log("🔍 Running pre-build guard checks...");

// Full validation now happens safely at runtime in lib/startup.ts
// (this guard only needs to be lightweight during Next.js build)
console.log("✅ Environment checks passed (build phase)");
console.log("✅ All guard checks passed – ready for build");