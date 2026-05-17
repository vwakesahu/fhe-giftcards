/* Shared inline SVGs + the wordmark. Inline (not files in /public)
   so they pick up currentColor and can be styled per usage. */

import { cn } from "@/lib/utils";

type IconProps = React.SVGProps<SVGSVGElement> & { className?: string };

/**
 * SigillWordmark — the brand wordmark, same treatment as the app's
 * sidebar in packages/app/src/components/app-sidebar.tsx.
 *
 * Italic serif "sigill" (Instrument Serif, already loaded by layout.tsx)
 * with an optional small mono "beta" tag baseline-aligned next to it.
 *
 * Size is controlled by the parent through `className` (e.g. text-[20px]
 * for nav, text-[15px] for the footer). Color uses currentColor so it
 * inherits whatever you set.
 */
export function SigillWordmark({
  className,
  withBeta = false,
  betaClassName,
}: {
  className?: string;
  withBeta?: boolean;
  betaClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className="font-serif italic leading-none tracking-tight">
        sigill
      </span>
      {withBeta && (
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.15em] opacity-50",
            betaClassName,
          )}
        >
          beta
        </span>
      )}
    </span>
  );
}

/** GitHub mark. Single path, currentColor for theming. */
export function GithubGlyph({ className = "size-[18px]", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      {...rest}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 015.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.53 11.53 0 0023.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}
