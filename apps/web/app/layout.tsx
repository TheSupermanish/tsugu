import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";

const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Tsugu — proof, not promises",
  description:
    "Fund anything worth funding. The money is held safe and released only when the claim is proven true by Somnia's consensus AI. Give without fear. Raise without being doubted.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <Nav />
          <main>{children}</main>
          <footer className="mx-auto mt-24 max-w-6xl px-6 py-10 text-xs text-porcelain-faint">
            <div className="seam mb-6" />
            Tsugu · money that moves on proof · verified by Somnia consensus AI on Shannon testnet
          </footer>
        </Providers>
      </body>
    </html>
  );
}
