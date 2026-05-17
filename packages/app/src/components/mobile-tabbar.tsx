"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Inbox, ShoppingBag, Wallet } from "lucide-react";

const NAV = [
  { title: "Orders", href: "/", Icon: Inbox },
  { title: "Buy", href: "/buy", Icon: ShoppingBag },
  { title: "Balances", href: "/wrap", Icon: Wallet },
];

/**
 * MobileTabbar — bottom nav at <md, iOS/Android standard pattern.
 *
 * Three tabs, icon + label, equal width. Always thumb-reachable.
 * The active tab gets a hairline indicator above it (matches the
 * landing's hairline aesthetic) and full-opacity text/icon. Other
 * tabs are muted.
 *
 * 64px tall (h-16) + safe-area inset on iOS so it sits above the
 * home indicator. Backdrop-blurred translucent background.
 */
export function MobileTabbar() {
  const pathname = usePathname();

  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/6 bg-background/95 backdrop-blur-sm"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="h-16 grid grid-cols-3">
        {NAV.map(({ href, title, Icon }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-label={title}
              aria-current={isActive ? "page" : undefined}
              className="relative h-full flex flex-col items-center justify-center gap-1.5"
            >
              {isActive && (
                <motion.span
                  layoutId="tabbar-active"
                  className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-sp"
                  transition={{ type: "spring", duration: 0.35, bounce: 0.18 }}
                />
              )}
              <Icon
                className={`size-[18px] transition-colors ${
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground/55"
                }`}
                strokeWidth={1.8}
              />
              <span
                className={`text-[11px] font-medium transition-colors ${
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground/55"
                }`}
              >
                {title}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
