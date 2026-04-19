export function shortAddr(addr?: string | null, lead = 4, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= lead + tail + 2) return addr;
  return `${addr.slice(0, 2 + lead)}…${addr.slice(-tail)}`;
}

export function formatUsdc(raw: bigint | undefined, fractionDigits = 2): string {
  if (raw === undefined) return "—";
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  const wholeStr = withCommas(whole);
  if (fractionDigits === 0) return wholeStr;
  const fracStr = frac.toString().padStart(6, "0").slice(0, fractionDigits);
  return `${wholeStr}.${fracStr}`;
}

/** Thousand separators for a non-negative bigint — e.g. 1234567 → "1,234,567". */
export function withCommas(n: bigint | number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function shortHandle(h: bigint | undefined, chars = 6): string {
  if (!h) return "";
  const hex = h.toString(16);
  return `0x${hex.slice(0, chars)}…${hex.slice(-chars)}`;
}
