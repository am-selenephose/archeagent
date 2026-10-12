import type { Metadata } from "next";
import { Geist_Mono, Instrument_Serif, Manrope } from "next/font/google";
import "./globals.css";
import "./pearl-theme.css";

const manrope = Manrope({ variable: "--font-atelier", subsets: ["latin"], display: "swap" });
const instrument = Instrument_Serif({ variable: "--font-editorial", subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Archeagent | Evidence-first AI software delivery",
  description:
    "Production control plane for evaluating AI-generated patches against tests, contracts, security, migrations, performance and evidence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: 'try { document.documentElement.dataset.theme = localStorage.getItem("archeagent-appearance") === "light" ? "light" : "dark"; } catch (_) { document.documentElement.dataset.theme = "dark"; }' }} />
      </head>
      <body className={`${manrope.variable} ${instrument.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
