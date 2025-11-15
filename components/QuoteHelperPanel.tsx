// components/QuoteHelperPanel.tsx

export default function QuoteHelperPanel() {
  const checklist = [
    "Outside size (L×W×H, inches)",
    "Quantity to quote",
    "Foam family (PE, EPE, or PU)",
    "Density (e.g., 1.7 lb)",
    "Number of cavities / pockets (if any)",
    "Cavity sizes (L×W×Depth, or Ødiameter×depth for round)",
  ];

  const example = [
    "Outside size: 18x12x3 in",
    "Quantity: 250",
    "Foam family: EPE",
    "Density: 1.7 lb",
    "Cavities: 2",
    "Cavity sizes: Ø6x1, 3x3x1",
  ].join("\n");

  return (
    <section className="mt-10 max-w-3xl mx-auto rounded-2xl border border-neutral-200 bg-white p-6 text-sm leading-relaxed text-neutral-800 shadow-lg">
      <h2 className="mb-2 text-base font-semibold">
        Example of a great quote request
      </h2>

      <p className="mb-3 text-neutral-700">
        For the fastest, cleanest quotes, include these details in your first
        message:
      </p>

      <ul className="mb-4 list-disc space-y-1 pl-5">
        {checklist.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <div className="rounded-xl border border-neutral-200 bg-neutral-900 p-4 font-mono text-xs text-neutral-50 whitespace-pre-wrap">
        {example}
      </div>
    </section>
  );
}
