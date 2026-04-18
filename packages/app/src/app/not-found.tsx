import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <h1 className="font-serif text-[clamp(4rem,10vw,8rem)] italic leading-none text-muted-foreground/10">
        404
      </h1>
      <p className="font-mono text-xs text-muted-foreground/40 mt-4">
        Page not found
      </p>
      <Link
        href="/"
        className="font-mono text-xs text-sp mt-6 hover:underline"
      >
        Back to dashboard &rarr;
      </Link>
    </div>
  );
}
