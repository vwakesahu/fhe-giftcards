import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileTabbar } from "@/components/mobile-tabbar";
import { MobileTopbar } from "@/components/mobile-topbar";
import { MotionProvider } from "@/components/motion-provider";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Sigill | Private checkout sealed by FHE",
  description: "Buy a gift card with a sealed envelope. Amounts encrypted end-to-end, on Base Sepolia.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <Providers>
            <TooltipProvider>
              {/* Desktop (md+): fixed sidebar on the left.
                  Mobile (<md): top bar carries brand + wallet, bottom
                  tab bar carries the three nav items. */}
              <AppSidebar />
              <MobileTopbar />
              <MobileTabbar />
              <main className="min-h-screen pt-14 pb-20 md:pt-0 md:pb-0 md:pl-[220px]">
                <div className="mx-auto w-full max-w-2xl px-5 py-6 sm:px-8 sm:py-8 md:px-10 md:py-10">
                  <MotionProvider>{children}</MotionProvider>
                </div>
              </main>
            </TooltipProvider>
            <Toaster theme="dark" position="bottom-right" />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
