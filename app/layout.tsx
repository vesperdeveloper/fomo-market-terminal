import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap",
});

export const metadata: Metadata = {
  // pinned, because Next resolves relative metadata URLs against
  // VERCEL_URL and would otherwise point link previews at whichever
  // alias built the deployment
  metadataBase: new URL("https://terminal.fomomarket.trade"),
  title: "fomo market · the traders are the instrument",
  description:
    "Up or down on a fomo trader's account PnL. Pick a handle, pick a window, stake USDG into the market's own contract. Settled on chain from a public snapshot record.",
  openGraph: {
    title: "fomo market · the traders are the instrument",
    description:
      "Up or down on whether a fomo trader's account PnL is green over the next day or week. One contract on Robinhood Chain holds every stake and pays every winner.",
    images: [{ url: "/brand/og.jpg", width: 1200, height: 400 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@usefomo_market",
    creator: "@usefomo_market",
    title: "fomo market · the traders are the instrument",
    images: ["/brand/og.jpg"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${grotesk.variable} ${inter.variable} ${plexMono.variable}`}>
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
