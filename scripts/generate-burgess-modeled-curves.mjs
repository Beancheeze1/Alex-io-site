// scripts/generate-burgess-modeled-curves.mjs
//
// One-time (re-runnable) population: for every material in cushion_curves
// that has real 'tested' data at exactly one thickness, fit the Burgess
// (1990) "stress-energy" method from that material's own tested curve and
// generate derived curves at OTHER thicknesses, tagged provenance='modeled'.
//
// Source equations (Marcondes, Batt, Darby & Daum, "Determining the Minimum
// Sample Size Using a Simplified Method for Determining Cushion Curves",
// Journal of Applied Packaging Research 2(4), 2008, directly citing and
// reproducing Burgess 1990, Packaging Technology and Science 3(4):189-194):
//   y = a * e^(b*x)   where y = G*s (dynamic stress), x = s*h/t (dynamic energy)
// Fit (a,b) via linear regression of ln(y) vs x on the material's own tested
// points; predict G at a new thickness via x' = s*h/t', y' = a*e^(b*x'), G'=y'/s.
// This mirrors app/lib/cushion/engine.ts's fitStressEnergyModel /
// predictGFromStressEnergyModel -- keep both in sync if either changes.
//
// SCOPE RESTRICTIONS, decided from real validation evidence, not guessed:
//
// 1. THICKER ONLY (3in/4in/5in from a 2in base), never thinner (1in).
//    Checked empirically across all 27 eligible materials: extrapolating to
//    1in produced max predicted G of 350-500 for every single one --
//    physically implausible (no real cushion curve reaches that). Thicker
//    extrapolation (3/4/5in) stayed in a plausible 26-82G range for all 27.
//    This isn't arbitrary caution: increasing thickness REDUCES the energy
//    term x=s*h/t, moving further into the well-conditioned region the
//    exponential fit was calibrated on; decreasing thickness increases x,
//    moving into the region where small fit errors amplify exponentially.
//
// 2. Static-psi grid clamped to each material's OWN tested psi range --
//    we don't extrapolate the stress axis beyond what was actually tested,
//    only the thickness axis.
//
// 3. Hard sanity ceiling: any predicted point with G > 150 is rejected and
//    logged (belt-and-suspenders; restrictions 1+2 already keep everything
//    under 82G in testing, so this should rarely if ever fire).
//
// VALIDATION (see the real numbers this script's `source` text embeds):
// cross-checked by fitting the same method from a 2in curve for the two
// materials that have real 5-thickness tested data (233=2.2 PCF, 223=1.6
// PCF PE) and comparing against their real tested 1/3/4/5in curves. Result:
// 16-45% mean error depending on material, up to 200%+ at range extremes --
// well short of tested/proxy reliability. 'modeled' ranks below all three
// other provenance tiers in app/lib/cushion/engine.ts's trust order.
//
// Usage:
//   node scripts/generate-burgess-modeled-curves.mjs              # dry run
//   node scripts/generate-burgess-modeled-curves.mjs --apply       # writes
//
// Requires DATABASE_URL in the environment.

import pg from "pg";

const APPLY = process.argv.includes("--apply");
const DROP_IN = 24;
const NEW_THICKNESSES = [3, 4, 5]; // deliberately excludes 1in -- see header
const PSI_GRID = [0.10, 0.25, 0.50, 0.75, 1.00, 1.25, 1.50, 1.75, 2.00, 2.25, 2.50];
const SANITY_CEILING_G = 150;

function fitStressEnergyModel(points, thicknessIn, dropIn) {
  if (points.length < 2) return null;
  const xs = [];
  const lnYs = [];
  for (const p of points) {
    const x = (p.static_psi * dropIn) / thicknessIn;
    const y = p.g_level * p.static_psi;
    if (!(x > 0) || !(y > 0)) continue;
    xs.push(x);
    lnYs.push(Math.log(y));
  }
  if (xs.length < 2) return null;
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanLnY = lnYs.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (lnYs[i] - meanLnY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  const b = num / den;
  const lnA = meanLnY - b * meanX;
  const a = Math.exp(lnA);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = lnA + b * xs[i];
    ssRes += (lnYs[i] - pred) ** 2;
    ssTot += (lnYs[i] - meanLnY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { a, b, r2 };
}

function predictG(model, staticPsi, dropIn, thicknessIn) {
  const x = (staticPsi * dropIn) / thicknessIn;
  const y = model.a * Math.exp(model.b * x);
  return y / staticPsi;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL in environment.");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    const targets = await client.query(`
      WITH per_material AS (
        SELECT material_id, COUNT(DISTINCT thickness_in) AS distinct_thicknesses,
               bool_or(provenance = 'tested') AS has_tested
        FROM cushion_curves GROUP BY material_id
      )
      SELECT pm.material_id, m.name
      FROM per_material pm JOIN materials m ON m.id = pm.material_id
      WHERE pm.has_tested AND pm.distinct_thicknesses = 1
      ORDER BY pm.material_id;
    `);
    console.log(`Target materials (single-thickness, has 'tested' data): ${targets.rows.length}`);

    let toInsert = [];
    let modeledMaterialCount = 0;
    const skipped = [];
    const rejectedPoints = [];
    const fitReport = [];

    for (const { material_id, name } of targets.rows) {
      const rows = await client.query(
        `SELECT static_psi, g_level FROM cushion_curves WHERE material_id = $1 AND provenance = 'tested' ORDER BY static_psi;`,
        [material_id],
      );
      const points = rows.rows.map((r) => ({
        static_psi: Number(r.static_psi),
        g_level: Number(r.g_level),
      }));

      const model = fitStressEnergyModel(points, 2, DROP_IN);
      if (!model) {
        skipped.push({ material_id, name, reason: `only ${points.length} tested point(s) -- cannot fit` });
        continue;
      }

      const minPsi = Math.min(...points.map((p) => p.static_psi));
      const maxPsi = Math.max(...points.map((p) => p.static_psi));
      const ownGrid = PSI_GRID.filter((p) => p >= minPsi - 1e-9 && p <= maxPsi + 1e-9);

      fitReport.push({ material_id, name, a: model.a, b: model.b, r2: model.r2, n: points.length });

      const source =
        `Modeled via Burgess (1990) "stress-energy" method (Packaging Technology and Science 3(4):189-194), ` +
        `fit from this material's own tested 2in/24in curve (n=${points.length} pts, log-linear R^2=${model.r2.toFixed(4)}). ` +
        `NOT independently validated for this specific material. Cross-validated by fitting the same method from a ` +
        `2in curve and comparing against real 5-thickness tested data (materials 233 [2.2 PCF] and 223 [1.6 PCF]): ` +
        `mean error 16-45% depending on material and extrapolation distance, up to 200%+ at range extremes. Thinner ` +
        `(1in) extrapolation was empirically unstable for every material tested (350-500G, physically implausible) ` +
        `and is deliberately not generated. Treat with more caution than tested or proxy data -- verify with ` +
        `real-world testing before relying on it.`;

      let materialHadInsert = false;
      for (const t of NEW_THICKNESSES) {
        for (const psi of ownGrid) {
          const g = predictG(model, psi, DROP_IN, t);
          if (!Number.isFinite(g) || g <= 0 || g > SANITY_CEILING_G) {
            rejectedPoints.push({ material_id, name, t, psi, g });
            continue;
          }
          toInsert.push({ material_id, static_psi: psi, g_level: g, thickness_in: t, source });
          materialHadInsert = true;
        }
      }
      if (materialHadInsert) modeledMaterialCount++;
    }

    console.log(`\nFitted models: ${fitReport.length} | Skipped (insufficient data): ${skipped.length}`);
    if (skipped.length) console.log("Skipped:", skipped);
    console.log(`Rows to insert: ${toInsert.length} across ${modeledMaterialCount} materials`);
    if (rejectedPoints.length) {
      console.log(`Rejected by sanity ceiling (G>${SANITY_CEILING_G}): ${rejectedPoints.length}`);
      console.log(rejectedPoints.slice(0, 10));
    }

    const r2s = fitReport.map((f) => f.r2).sort((a, b) => a - b);
    console.log(
      `\nFit quality (log-linear R^2): min=${r2s[0].toFixed(4)} median=${r2s[Math.floor(r2s.length / 2)].toFixed(4)} max=${r2s[r2s.length - 1].toFixed(4)}`,
    );

    if (!APPLY) {
      console.log("\nDry run -- no rows written. Re-run with --apply to insert.");
      return;
    }

    await client.query("BEGIN");
    for (const row of toInsert) {
      await client.query(
        `INSERT INTO cushion_curves (material_id, static_psi, deflect_pct, g_level, thickness_in, drop_in, provenance, source, deflect_note)
         VALUES ($1, $2, NULL, $3, $4, $5, 'modeled', $6, $7)`,
        [
          row.material_id,
          row.static_psi,
          row.g_level,
          row.thickness_in,
          DROP_IN,
          row.source,
          "Not present -- Burgess-modeled curve, no source chart at all for this thickness.",
        ],
      );
    }
    await client.query("COMMIT");
    console.log(`\nInserted ${toInsert.length} modeled rows.`);

    const after = await client.query(
      `SELECT COUNT(*) AS total_modeled, COUNT(DISTINCT material_id) AS materials_with_modeled FROM cushion_curves WHERE provenance = 'modeled';`,
    );
    console.log("Post-insert verification:", after.rows[0]);
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("FAILED:", e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
