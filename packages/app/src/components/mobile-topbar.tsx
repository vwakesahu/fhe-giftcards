"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

import { shortAddr } from "@/lib/format";

/**
 * MobileTopbar — replaces the fixed left sidebar at <md.
 *
 * Deliberately minimal: wordmark on the left, wallet pill on the
 * right. Two elements. Nav lives in <MobileTabbar /> at the bottom
 * of the screen (iOS/Android standard pattern), which leaves this
 * bar uncrowded and thumb-reachable.
 */
export function MobileTopbar() {
  return (
    <header className="md:hidden fixed inset-x-0 top-0 z-40 h-14 border-b border-white/6 bg-background/95 backdrop-blur-sm">
      <div className="h-full flex items-center justify-between px-4 sm:px-5">
        <Link
          href="/"
          className="inline-flex items-baseline"
          aria-label="Sigill"
        >
          <span className="font-serif text-[22px] leading-none italic tracking-tight text-foreground">
            sigill
          </span>
        </Link>

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
              className="h-9 px-4 text-[13px] font-medium bg-sp text-[#0d0c0a] hover:bg-sp/90 transition-colors rounded-full"
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
              Wrong network
            </button>
          );
        }

        return (
          <button
            onClick={openAccountModal}
            className="h-9 px-3.5 inline-flex items-center text-[12.5px] font-medium rounded-full border border-white/10 hover:bg-white/4 transition-colors"
          >
            <span className="tabular-nums">
              {account.ensName ?? shortAddr(account.address, 4, 4)}
            </span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
