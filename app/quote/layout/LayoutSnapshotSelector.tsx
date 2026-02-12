// app/quote/layout/LayoutSnapshotSelector.tsx
//
// Dropdown component for loading previous layout configurations.
// Displays all saved packages for a quote with metadata.

"use client";

import * as React from "react";

type PackageItem = {
  id: number;
  packageNumber: number;
  blockLabel: string;
  cavityCount: number;
  layerCount: number;
  notes: string | null;
  createdAt: string;
};

type Props = {
  quoteNo: string;
  currentRevision: string;
  onLoadLayout: (packageId: number) => Promise<void>;
  disabled?: boolean;
};

export default function LayoutSnapshotSelector({
  quoteNo,
  currentRevision,
  onLoadLayout,
  disabled = false,
}: Props) {
  const [packages, setPackages] = React.useState<PackageItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showDropdown, setShowDropdown] = React.useState(false);
  const [loadingPackageId, setLoadingPackageId] = React.useState<number | null>(
    null
  );
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    }

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [showDropdown]);

  // Fetch packages when component mounts or quoteNo changes
  React.useEffect(() => {
    if (!quoteNo) return;

    async function fetchPackages() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/quote/layout/packages?quote_no=${encodeURIComponent(quoteNo)}`,
          { cache: "no-store" }
        );

        if (!res.ok) {
          throw new Error("Failed to load packages");
        }

        const json = await res.json();
        if (json.ok && Array.isArray(json.packages)) {
          setPackages(json.packages);
        } else {
          setError(json.error || "Unknown error");
        }
      } catch (err: any) {
        setError(err.message || "Network error");
      } finally {
        setLoading(false);
      }
    }

    fetchPackages();
  }, [quoteNo]);

  const handleSelectPackage = async (packageId: number) => {
    setLoadingPackageId(packageId);
    try {
      await onLoadLayout(packageId);
      setShowDropdown(false);
    } catch (err: any) {
      alert(`Failed to load layout: ${err.message}`);
    } finally {
      setLoadingPackageId(null);
    }
  };

  // Don't show if there's only one package (the current one)
  if (packages.length <= 1) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={loading || disabled}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Load a previous layout configuration"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        Load Previous Layout
        <svg
          className={`w-4 h-4 transition-transform ${
            showDropdown ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {showDropdown && (
        <div className="absolute right-0 z-50 mt-2 w-96 bg-white rounded-lg shadow-xl ring-1 ring-black ring-opacity-5">
          <div className="py-1 max-h-96 overflow-y-auto">
            {loading && (
              <div className="px-4 py-3 text-sm text-gray-500">
                Loading packages...
              </div>
            )}

            {error && (
              <div className="px-4 py-3 text-sm text-red-600">{error}</div>
            )}

            {!loading && !error && packages.length === 0 && (
              <div className="px-4 py-3 text-sm text-gray-500">
                No previous layouts found
              </div>
            )}

            {!loading &&
              !error &&
              packages.map((pkg) => {
                const isLoading = loadingPackageId === pkg.id;
                const createdDate = new Date(pkg.createdAt).toLocaleDateString(
                  undefined,
                  {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }
                );

                return (
                  <button
                    key={pkg.id}
                    type="button"
                    onClick={() => handleSelectPackage(pkg.id)}
                    disabled={isLoading}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 focus:outline-none focus:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed border-b border-gray-100 last:border-b-0 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
                            Package #{pkg.packageNumber}
                          </span>
                          <span className="text-xs text-gray-500">
                            {createdDate}
                          </span>
                        </div>

                        <div className="text-sm font-medium text-gray-900">
                          Block: {pkg.blockLabel}
                        </div>

                        <div className="text-xs text-gray-500 mt-0.5">
                          {pkg.layerCount} {pkg.layerCount === 1 ? "layer" : "layers"} • {pkg.cavityCount}{" "}
                          {pkg.cavityCount === 1 ? "cavity" : "cavities"}
                        </div>

                        {pkg.notes && (
                          <div className="text-xs text-gray-600 mt-1 line-clamp-2">
                            {pkg.notes}
                          </div>
                        )}
                      </div>

                      {isLoading ? (
                        <div className="flex-shrink-0">
                          <svg
                            className="animate-spin h-4 w-4 text-indigo-600"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                          </svg>
                        </div>
                      ) : (
                        <div className="flex-shrink-0 text-gray-400">
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
          </div>

          <div className="border-t border-gray-100 px-4 py-2 bg-gray-50 text-xs text-gray-500 rounded-b-lg">
            Current revision:{" "}
            <span className="font-medium text-gray-700">{currentRevision}</span>
          </div>
        </div>
      )}
    </div>
  );
}

