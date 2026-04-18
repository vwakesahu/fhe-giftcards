"use client";

import { blo } from "blo";
import Image from "next/image";

/**
 * Deterministic Ethereum avatar (noble-blockies via `blo`). Renders a colorful
 * 4x4 gradient tied to the address. Tiny bundle, no canvas hacks.
 */
export function Identicon({
  address,
  size = 20,
  className = "",
}: {
  address?: `0x${string}` | string | null;
  size?: number;
  className?: string;
}) {
  if (!address) {
    return (
      <div
        className={`rounded-full bg-muted ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const src = blo(address as `0x${string}`, size * 2);
  return (
    <Image
      src={src}
      alt={address}
      width={size}
      height={size}
      className={`rounded-full ${className}`}
      unoptimized
    />
  );
}
