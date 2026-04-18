import { cn } from "@/lib/utils";

/**
 * Compact spinner in the RainbowKit style — a rotating SVG arc.
 * `currentColor` so callers pick the tint via className.
 */
export function Spinner({
  size = 12,
  strokeWidth = 2.5,
  className,
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      className={cn("animate-spin shrink-0", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth={strokeWidth}
      />
      <path
        d="M22 12A10 10 0 0 0 12 2"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}
