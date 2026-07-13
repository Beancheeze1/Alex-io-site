# Alex-IO Design System

Canonical reference for Alex-IO's visual identity. Any UI work — new pages, restyling existing ones, new components — should pull from this file rather than inventing new colors, spacing, or type choices ad hoc. If a situation isn't covered here, extend this document first, then build.

## Why this exists

The app's original visual language (dark mode, saturated sky-blue, pill buttons, default system font) reads as a generic consumer/dev-tool SaaS template — a strong fit for developers, a weak fit for the actual buyer: packaging engineers, plant managers, and purchasing directors evaluating whether to trust a vendor's software with real POs and production drawings. This system replaces it with something that reads as a precision instrument: clean, quiet, confident, closer to how a well-made engineering tool or premium hardware brand's software looks than a startup landing page.

## Core principles

1. **Light only.** Dark mode is retired. Don't add `dark:` variants or theme-toggle logic to new components.
2. **One accent, used narrowly.** There is no "brand blue" or "brand color" in the decorative sense. Primary actions are near-black graphite. The one hue in the whole system — a muted brick-red ("redline") — is reserved exclusively for things that genuinely need the user's attention (see "Redline — needs attention" below). Don't reach for it to make something "pop."
3. **Structure over color for hierarchy.** A page should read clearly through surface layering (page vs. card vs. panel), hairline borders, and type weight/size — not through added color. If a page feels flat, the fix is almost always spacing/borders/type-scale, not a new color.
4. **Numbers are the point.** This is a quoting tool — prices, dimensions, quantities are what the user is actually looking for on any given screen. Give them more visual weight than surrounding UI chrome.
5. **Sentence case everywhere.** Buttons, headings, labels, table headers. Never Title Case, never ALL CAPS except small uppercase eyebrow labels (which use letter-spacing, not weight, to read as calm rather than shouty).

## Typeface

**Inter**, loaded via Google Fonts (`https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap`) or self-hosted equivalent. Weights used: 400 (body/regular) and 500 (emphasis/labels/headings). Avoid 600/700 in normal UI — they read as heavy against this otherwise quiet palette. 600 is reserved for rare, deliberate emphasis only (e.g. a large price on the print quote).

Monospace (for quote numbers, dimensions, or anywhere exact character alignment matters — e.g. a column of prices): system monospace stack (`ui-monospace, SFMono-Regular, "Roboto Mono", monospace`) is fine; no need for a custom mono font.

## Color tokens

All values are final hex — this is a light-only system, no dark-mode pairing needed.

### Surfaces (the layering system)
| Token | Value | Use |
|---|---|---|
| `--surface-page` | `#FAFAF8` | Page/app background. Never pure white — this is what keeps cards from disappearing into the page. |
| `--surface-card` | `#FFFFFF` | Cards, panels, modals, table bodies — anything that should read as "on top of" the page. |
| `--surface-subtle` | `#F7F5F0` | Table header rows, section dividers within a card, subtly-recessed areas. |

### Borders
| Token | Value | Use |
|---|---|---|
| `--border` | `#E4E4E0` | Default hairline — card edges, table row dividers, input borders. |
| `--border-strong` | `#D6D6D0` | Hover states, secondary button borders. |

### Text
| Token | Value | Use |
|---|---|---|
| `--text-primary` | `#1C1C1A` | Headings, primary values (prices, quote numbers), body copy. |
| `--text-secondary` | `#4A4A45` | Supporting text, table cell content that isn't the primary value. |
| `--text-muted` | `#7A7A74` | Labels, captions, eyebrow text, table column headers. |
| `--text-faint` | `#9A9A94` | Placeholder text, disabled states, least-important metadata. |

### Primary action (graphite — no hue)
| Token | Value | Use |
|---|---|---|
| `--action-primary` | `#2B2B28` | Primary button fill. |
| `--action-primary-hover` | `#3D3D38` | Primary button hover. |
| `--action-text-on-primary` | `#FFFFFF` | Text/icon on a primary-filled button. |

Secondary buttons: white fill, `--border-strong` border, `--text-primary` text, no separate token needed.

### Redline — needs attention (the one hue)
Reserved exclusively for: validation errors, a quote/tenant/setting that's locked or blocked pending action, a genuinely urgent status. Never used for a primary CTA, a decorative highlight, or "just to add visual interest." If you're reaching for this color and the thing on screen doesn't require the user to *do* something, use graphite or a status color instead.

| Token | Value | Use |
|---|---|---|
| `--attention` | `#A63D2E` | Text/icon color for needs-attention items, error text, a small marker/dot. |
| `--attention-bg` | `#FAECE7` | Pale background for an attention badge or inline alert. |
| `--attention-border` | `#E8B8AC` | Border for an attention-toned card/alert box. |

### Status colors (semantic, not decorative)
Used for quote/tenant/record status badges and similar — color tied directly to meaning, appears only where that meaning applies.

| Status | Background | Text |
|---|---|---|
| Success / released / active / paid | `#EAF3DE` | `#27500A` |
| Pending / in progress / warning | `#FAEEDA` | `#633806` |
| Neutral / draft / inactive | `#F1EFE8` | `#444441` |
| Needs attention / error / locked-blocked | `#FAECE7` (= `--attention-bg`) | `#A63D2E` (= `--attention`) |

## Type scale

| Role | Size | Weight | Notes |
|---|---|---|---|
| Large value (price on a quote, big stat) | 26–32px | 500 | The one place 600 is acceptable if it needs to anchor a whole screen (e.g. the print quote's total). |
| Page title (h1) | 20–22px | 500 | |
| Section heading (h2) | 16–17px | 500 | |
| Body | 14px | 400 | Default for most UI text. |
| Label / table header / eyebrow | 11–12px | 500 | Uppercase with `letter-spacing: 0.04em–0.06em`, colored `--text-muted`. |
| Caption / metadata | 12–13px | 400 | `--text-secondary` or `--text-muted` depending on importance. |

`line-height`: 1.4–1.5 for body text, tighter (1.1–1.2) for large numeric values.

## Shape and spacing

- **Border radius**: buttons and inputs `6px`. Cards and panels `8–12px`. Status badges/pills `20px` (full pill) — pills are fine at small badge scale, just not for large buttons.
- **Borders, not shadows**, for separating elements. No `box-shadow` for card elevation — a `1px solid var(--border)` does that job. (Focus rings are the one exception — see below.)
- **Spacing scale**: 4 / 8 / 12 / 16 / 20 / 24 / 32px. Card internal padding: 16–20px. Section gaps: 20–24px.
- **Focus states**: `2px solid var(--action-primary)` border or an equivalent subtle ring — needs to remain clearly visible for accessibility even without a bright accent color to lean on.

## Component patterns

**Primary button**: `--action-primary` fill, white text, `6px` radius, `500` weight, `9px 16px` padding (or similar), hover → `--action-primary-hover`.

**Secondary button**: white fill, `1px solid var(--border-strong)`, `--text-primary` text, same radius/padding as primary.

**Status badge**: pill shape, semantic bg/text pair from the table above, `11px`/`500`, `3px 10px` padding.

**Card**: `--surface-card` background, `1px solid var(--border)`, `8–12px` radius, `16–20px` padding.

**Table**: header row on `--surface-subtle`, `1px solid var(--border)` row dividers (no zebra striping), primary column values in `--text-primary`/`500`, secondary columns in `--text-secondary`.

**Filter pills / tabs**: selected state gets a filled pale background (reuse the relevant semantic or neutral tone) with matching-tone text; unselected state is a plain outlined pill.

## What NOT to do

- No `rounded-full` on anything larger than a small badge (no more pill-shaped primary buttons).
- No saturated/glowing accent colors. If a new color feels like it needs to be added, it's very likely meant to be one of the existing status colors or the attention red — check this table first.
- No `bg-slate-950` / dark-panel treatments on new components. If you're porting an old dark component, restyle it against `--surface-page` / `--surface-card` instead of just lightening the existing dark values.
- No decorative grid/blueprint background patterns, gradients, or glow effects.
- No default system font — always Inter.

## Rollout order

Highest-visibility-to-a-prospect first, since that's the actual problem this redesign solves:

1. `/landing` and `/t/[tenant]` (what a prospect or their boss sees before ever touching the product)
2. `StartQuoteModal` (the customer-facing quote wizard) and the quote print/view page
3. `RepStartQuoteModal` and the layout editor (`/quote/layout`)
4. Admin pages, roughly in order of how often they're actually used day to day
