// lib/pdf/parser.ts
//
// PDF import parser that extracts dimensions, text, and specifications
// from customer-uploaded PDF drawings.
//
// Capabilities:
// - Extract all text content from PDF
// - Parse common dimension formats (e.g., "12 x 8 x 3", "L: 12", "12" x 8"")
// - Identify material callouts
// - Extract quantity information
// - OCR support for scanned PDFs

import { ocrImageToText } from "@/lib/ocr";

// Dynamic import for pdf-parse to handle ESM/CJS compatibility
let pdfParse: any;

async function getPdfParse() {
  if (!pdfParse) {
    try {
      const module: any = await import("pdf-parse");
      pdfParse = module.default || module;
    } catch {
      // @ts-ignore - fallback to require for CommonJS
      pdfParse = require("pdf-parse");
    }
  }
  return pdfParse;
}

export type ParsedDimensions = {
  length?: number | null;
  width?: number | null;
  height?: number | null;
  thickness?: number | null;
  units?: "in" | "mm" | null;
  confidence: "high" | "medium" | "low";
};

export type ParsedMaterial = {
  name: string;
  density?: number | null;
  family?: string | null;
  confidence: "high" | "medium" | "low";
};

export type ParsedPdfData = {
  text: string; // All extracted text
  dimensions: ParsedDimensions[];
  materials: ParsedMaterial[];
  qty?: number | null;
  notes: string[];
  metadata: {
    pages: number;
    hasImages: boolean;
    needsOcr: boolean;
  };
};

/**
 * Main entry point: Parse a PDF buffer and extract quote-relevant data
 */
export async function parsePdfToQuoteData(pdfBuffer: Buffer): Promise<ParsedPdfData> {
  // Get pdf-parse dynamically
  const parse = await getPdfParse();
  
  // Extract text from PDF
  const pdfData = await parse(pdfBuffer);
  
  let fullText = pdfData.text || "";
  const pages = pdfData.numpages || 0;
  
  // If text is suspiciously short, the PDF might be scanned/image-based
  const needsOcr = fullText.trim().length < 50 && pages > 0;
  
  // TODO: If needsOcr, we'd need to convert PDF pages to images and run OCR
  // For now, we'll work with whatever text we have
  
  const result: ParsedPdfData = {
    text: fullText,
    dimensions: [],
    materials: [],
    qty: null,
    notes: [],
    metadata: {
      pages,
      hasImages: false, // pdfParse doesn't easily expose this
      needsOcr,
    },
  };
  
  // Parse dimensions from text
  result.dimensions = extractDimensions(fullText);
  
  // Parse material callouts
  result.materials = extractMaterials(fullText);
  
  // Parse quantity
  result.qty = extractQuantity(fullText);
  
  // Extract notes/special instructions
  result.notes = extractNotes(fullText);
  
  return result;
}

/**
 * Extract dimensions from text using various common formats:
 * - "12 x 8 x 3"
 * - "L: 12 W: 8 H: 3"
 * - "12" x 8" x 3""
 * - "Length: 12 inches"
 * - "305mm x 203mm x 76mm"
 */
function extractDimensions(text: string): ParsedDimensions[] {
  const results: ParsedDimensions[] = [];
  
  // Normalize text: lowercase, remove extra whitespace
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  
  // Pattern 1: "12 x 8 x 3" or "12" x 8" x 3"" or "12 X 8 X 3"
  const pattern1 = /(\d+\.?\d*)\s*["']?\s*[xX×]\s*(\d+\.?\d*)\s*["']?\s*[xX×]\s*(\d+\.?\d*)\s*["']?/g;
  let match;
  
  while ((match = pattern1.exec(normalized)) !== null) {
    const [_, l, w, h] = match;
    results.push({
      length: parseFloat(l),
      width: parseFloat(w),
      height: parseFloat(h),
      thickness: parseFloat(h), // Height often means thickness in foam
      units: guessUnits(normalized, match.index),
      confidence: "high",
    });
  }
  
  // Pattern 2: "L: 12 W: 8 H: 3" or "Length: 12" or "Lng 12"
  const lengthMatch = /(?:length|lng|l)[:\s]+(\d+\.?\d*)/i.exec(normalized);
  const widthMatch = /(?:width|wid|w)[:\s]+(\d+\.?\d*)/i.exec(normalized);
  const heightMatch = /(?:height|hgt|h|thick|thickness|t)[:\s]+(\d+\.?\d*)/i.exec(normalized);
  
  if (lengthMatch || widthMatch || heightMatch) {
    results.push({
      length: lengthMatch ? parseFloat(lengthMatch[1]) : null,
      width: widthMatch ? parseFloat(widthMatch[1]) : null,
      height: heightMatch ? parseFloat(heightMatch[1]) : null,
      thickness: heightMatch ? parseFloat(heightMatch[1]) : null,
      units: guessUnits(normalized),
      confidence: "medium",
    });
  }
  
  // Pattern 3: Single dimension callouts like "12.5 inches" or "305mm"
  const dimCallouts = /(\d+\.?\d*)\s*(inch|in|"|mm|millimeter|cm|centimeter)/gi;
  const singles: { value: number; unit: string }[] = [];
  
  while ((match = dimCallouts.exec(normalized)) !== null) {
    singles.push({
      value: parseFloat(match[1]),
      unit: match[2].toLowerCase(),
    });
  }
  
  // If we found 3 singles in sequence, treat as L x W x H
  if (singles.length >= 3 && results.length === 0) {
    const unit = singles[0].unit.startsWith("m") ? "mm" : "in";
    results.push({
      length: singles[0].value,
      width: singles[1].value,
      height: singles[2].value,
      thickness: singles[2].value,
      units: unit,
      confidence: "low",
    });
  }
  
  return results;
}

/**
 * Guess units from context (looks for "mm", "millimeter", "inch", etc.)
 */
function guessUnits(text: string, position?: number): "in" | "mm" | null {
  // Check near the match if position provided
  const snippet = position !== undefined 
    ? text.slice(Math.max(0, position - 30), position + 50)
    : text;
  
  if (/mm|millimeter/i.test(snippet)) return "mm";
  if (/cm|centimeter/i.test(snippet)) {
    // Assume mm if cm found (we'll convert)
    return "mm";
  }
  if (/inch|in|"/i.test(snippet)) return "in";
  
  // Default to inches (US standard)
  return "in";
}

/**
 * Extract material callouts from text
 * Looks for common foam material names and density callouts
 */
function extractMaterials(text: string): ParsedMaterial[] {
  const results: ParsedMaterial[] = [];
  const normalized = text.toLowerCase();
  
  // Common foam materials with patterns
  const materials = [
    { pattern: /polyurethane|poly\s*urethane|pu\s*foam|open\s*cell/i, name: "Polyurethane", family: "PU" },
    { pattern: /polyethylene|poly\s*ethylene|pe\s*foam|closed\s*cell/i, name: "Polyethylene", family: "PE" },
    { pattern: /epe|expanded\s*pe|ethafoam/i, name: "EPE", family: "PE" },
    { pattern: /eva|ethylene\s*vinyl\s*acetate/i, name: "EVA", family: "PE" },
    { pattern: /memory\s*foam|visco\s*elastic/i, name: "Memory Foam", family: "PU" },
    { pattern: /latex|natural\s*latex/i, name: "Latex", family: "Latex" },
  ];
  
  for (const mat of materials) {
    if (mat.pattern.test(text)) {
      // Look for density near the material mention
      const densityMatch = /(\d+\.?\d*)\s*(?:lb|lbs|pcf|kg)/i.exec(normalized);
      
      results.push({
        name: mat.name,
        family: mat.family,
        density: densityMatch ? parseFloat(densityMatch[1]) : null,
        confidence: "medium",
      });
    }
  }
  
  // Generic density callout without material
  if (results.length === 0) {
    const densityMatch = /(?:density|dens)[:\s]*(\d+\.?\d*)\s*(?:lb|lbs|pcf)/i.exec(normalized);
    if (densityMatch) {
      results.push({
        name: "Unknown",
        family: null,
        density: parseFloat(densityMatch[1]),
        confidence: "low",
      });
    }
  }
  
  return results;
}

/**
 * Extract quantity from text
 * Looks for "Qty: 10", "Quantity: 5", "5 pieces", etc.
 */
function extractQuantity(text: string): number | null {
  const normalized = text.toLowerCase();
  
  // Pattern: "qty: 10" or "quantity: 5"
  const qtyMatch = /(?:qty|quantity|pieces|pcs)[:\s]+(\d+)/i.exec(normalized);
  if (qtyMatch) {
    return parseInt(qtyMatch[1], 10);
  }
  
  // Pattern: "5 pieces" at start of line or after bullet
  const piecesMatch = /(?:^|[\n\r•])\s*(\d+)\s+(?:pieces|pcs|units|ea)/im.exec(normalized);
  if (piecesMatch) {
    return parseInt(piecesMatch[1], 10);
  }
  
  return null;
}

/**
 * Extract special notes/instructions
 * Looks for common note indicators
 */
function extractNotes(text: string): string[] {
  const notes: string[] = [];
  const lines = text.split(/[\n\r]+/);
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Look for lines starting with "NOTE:", "NOTES:", etc.
    if (/^(?:note|notes|special\s*instruction|instruction)s?:/i.test(trimmed)) {
      notes.push(trimmed);
    }
    
    // Look for lines with "!" or "***" which often indicate important info
    if (/[!]{2,}|[\*]{3,}/.test(trimmed) && trimmed.length > 10) {
      notes.push(trimmed);
    }
  }
  
  return notes;
}

/**
 * Helper: Convert dimensions to inches if needed
 */
export function convertToInches(value: number, units: "in" | "mm" | null | undefined): number {
  if (units === "mm") {
    return value / 25.4;
  }
  return value;
}

/**
 * Helper: Pick the "best" dimension set from multiple candidates
 * Prioritizes high confidence and complete dimensions
 */
export function selectBestDimensions(dimensions: ParsedDimensions[]): ParsedDimensions | null {
  if (dimensions.length === 0) return null;
  
  // Score each dimension set
  const scored = dimensions.map(dim => {
    let score = 0;
    
    // Confidence score
    if (dim.confidence === "high") score += 10;
    else if (dim.confidence === "medium") score += 5;
    else score += 1;
    
    // Completeness score
    if (dim.length !== null && dim.length !== undefined) score += 3;
    if (dim.width !== null && dim.width !== undefined) score += 3;
    if (dim.height !== null && dim.height !== undefined) score += 3;
    
    // Units known
    if (dim.units) score += 2;
    
    return { dim, score };
  });
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  return scored[0].dim;
}