"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { AnimatePresence, motion } from "motion/react";
import { Inbox, ShoppingBag, Wallet, LogOut } from "lucide-react";

import { Identicon } from "@/components/identicon";
import { BaseSepoliaIcon } from "@/components/icons";
import { EASE_OUT } from "@/lib/motion";
import { shortAddr } from "@/lib/format";

const NAV = [
  { title: "Orders", href: "/", icon: Inbox },
  { title: "Buy", href: "/buy", icon: ShoppingBag },
  { title: "Balances", href: "/wrap", icon: Wallet },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 w-[220px] border-r border-white/6 bg-background flex flex-col z-40">
      {/* Brand */}
      <div className="h-14 flex items-center px-5 border-b border-white/6">
        <Link href="/" className="inline-flex items-baseline gap-2">
          <span className="font-serif text-[20px] leading-none italic tracking-tight text-foreground">
            sigill
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40">
            beta
          </span>
        </Link>
      </div>

      {/* Section label */}
      <div className="px-5 pt-5 pb-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground/40">
        Workspace
      </div>

      {/* Nav */}
      <nav className="px-2 flex flex-col gap-0.5">
        {NAV.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative group h-8 px-3 flex items-center gap-2.5 rounded-full text-[13px] transition-colors"
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-full bg-white/5"
                  transition={{ type: "spring", duration: 0.35, bounce: 0.18 }}
                />
              )}
              <Icon
                className={`relative size-3.5 ${
                  isActive ? "text-foreground" : "text-muted-foreground/45 group-hover:text-muted-foreground/75"
                } transition-colors`}
                strokeWidth={1.8}
              />
              <span
                className={`relative ${
                  isActive ? "text-foreground font-medium" : "text-muted-foreground/75 group-hover:text-foreground"
                } transition-colors`}
              >
                {item.title}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Chain tag */}
      <div className="px-5 py-3 text-[11.5px] text-muted-foreground/45 border-t border-white/6 flex items-center gap-2">
        <BaseSepoliaIcon size={12} className="rounded-[3px]" />
        <span>Base Sepolia · testnet</span>
      </div>

      {/* Wallet */}
      <WalletBlock />
    </aside>
  );
}

function WalletBlock() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openAccountModal, openChainModal, mounted }) => {
        const connected = mounted && account && chain;

        if (!connected) {
          return (
            <div className="p-3">
              <motion.button
                onClick={openConnectModal}
                whileTap={{ scale: 0.98 }}
                className="w-full h-9 px-3 text-[13px] font-medium bg-sp text-[#050505] hover:bg-sp/90 transition-colors rounded-full"
              >
                Connect wallet
              </motion.button>
            </div>
          );
        }

        if (chain.unsupported) {
          return (
            <div className="p-3">
              <button
                onClick={openChainModal}
                className="w-full h-9 px-3 text-[12px] font-medium text-destructive border border-destructive/40 bg-destructive/10 rounded-full"
              >
                Wrong network
              </button>
            </div>
          );
        }

        return (
          <AnimatePresence mode="wait">
            <motion.div
              key={account.address}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className="p-3"
            >
              <button
                onClick={openAccountModal}
                className="w-full group flex items-center gap-3 h-11 pl-2 pr-3 rounded-full hover:bg-white/4 transition-colors"
              >
                <Identicon address={account.address} size={26} />
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-[13px] font-medium truncate leading-none">
                    {account.ensName ?? shortAddr(account.address, 4, 4)}
                  </p>
                  {account.displayBalance && (
                    <p className="mt-1 text-[11.5px] text-muted-foreground/55 tabular-nums truncate">
                      {account.displayBalance}
                    </p>
                  )}
                </div>
                <LogOut className="size-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/75 transition-colors" />
              </button>
            </motion.div>
          </AnimatePresence>
        );
      }}
    </ConnectButton.Custom>
  );
}
