export function shortAddr(addr?: string | null, lead = 4, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= lead + tail + 2) return addr;
  return `${addr.slice(0, 2 + lead)}…${addr.slice(-tail)}`;
}

export function formatUsdc(raw: bigint | undefined, fractionDigits = 2): string {
  if (raw === undefined) return "—";
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  if (fractionDigits === 0) return whole.toString();
  const fracStr = frac.toString().padStart(6, "0").slice(0, fractionDigits);
  return `${whole.toString()}.${fracStr}`;
}

export function shortHandle(h: bigint | undefined, chars = 6): string {
  if (!h) return "";
  const hex = h.toString(16);
  return `0x${hex.slice(0, chars)}…${hex.slice(-chars)}`;
}
