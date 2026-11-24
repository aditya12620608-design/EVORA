import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "QuantDeck — in-browser strategy backtesting",
  description:
    "Professional strategy backtesting in the browser: Python strategies on real market data, Indian charges & taxes, zero backend compute.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${plexSans.variable} ${plexMono.variable} bg-canvas font-sans text-ink antialiased`}>{children}</body>
    </html>
  );
}
