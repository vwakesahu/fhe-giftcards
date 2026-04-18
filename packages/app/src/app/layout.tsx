import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/app-sidebar";
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
  title: "Sigill — Private checkout sealed by FHE",
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
              <AppSidebar />
              <main className="min-h-screen pl-[220px]">
                <div className="mx-auto w-full max-w-2xl px-10 py-10">
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
