"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Inbox, ShoppingBag, Wallet } from "lucide-react";

import { shortAddr } from "@/lib/format";

const NAV = [
  { title: "Orders", href: "/", Icon: Inbox },
  { title: "Buy", href: "/buy", Icon: ShoppingBag },
  { title: "Balances", href: "/wrap", Icon: Wallet },
];

/**
 * MobileTopbar — replaces the fixed left sidebar at <md.
 *
 * Layout: wordmark left, icon-only nav center, compact wallet pill
 * right. Sits as a fixed top bar so it stays visible during scroll.
 * Same chrome density as the landing's nav so the two surfaces read
 * as one product.
 */
export function MobileTopbar() {
  const pathname = usePathname();
  return (
    <header className="md:hidden fixed inset-x-0 top-0 z-40 h-14 border-b border-white/6 bg-background/95 backdrop-blur-sm">
      <div className="h-full grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4">
        <Link
          href="/"
          className="inline-flex items-baseline gap-1.5"
          aria-label="Sigill"
        >
          <span className="font-serif text-[20px] leading-none italic tracking-tight text-foreground">
            sigill
          </span>
        </Link>

        <nav className="flex items-center justify-center gap-1">
          {NAV.map(({ href, title, Icon }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-label={title}
                title={title}
                className={`size-9 inline-flex items-center justify-center rounded-full transition-colors ${
                  isActive
                    ? "bg-white/5 text-foreground"
                    : "text-muted-foreground/60 hover:bg-white/4 hover:text-foreground"
                }`}
              >
                <Icon className="size-4" strokeWidth={1.8} />
              </Link>
            );
          })}
        </nav>

        <WalletPill />
      </div>
    </header>
  );
}

function WalletPill() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openAccountModal, openChainModal, mounted }) => {
        const connected = mounted && account && chain;

        if (!connected) {
          return (
            <button
              onClick={openConnectModal}
              className="h-9 px-3 text-[12px] font-medium bg-sp text-[#0a0a0a] hover:bg-sp/90 transition-colors rounded-full"
            >
              Connect
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              onClick={openChainModal}
              className="h-9 px-3 text-[12px] font-medium text-destructive border border-destructive/40 bg-destructive/10 rounded-full"
            >
              Wrong net
            </button>
          );
        }

        return (
          <button
            onClick={openAccountModal}
            className="h-9 px-3 inline-flex items-center gap-2 text-[12px] font-medium rounded-full hover:bg-white/4 transition-colors"
          >
            <span className="block size-2 rounded-full bg-sp" aria-hidden />
            <span className="tabular-nums">
              {account.ensName ?? shortAddr(account.address, 4, 4)}
            </span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
