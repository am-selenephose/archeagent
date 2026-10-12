import type { Metadata } from "next";
import { Geist_Mono, Jost } from "next/font/google";
import "./globals.css";
import "./pearl-theme.css";
import "./immersive-material.css";

const jost = Jost({ variable: "--font-atelier", subsets: ["latin"], weight: ["300", "400", "500"], display: "swap" });
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
      <body className={`${jost.variable} ${geistMono.variable}`}>
        <div className="material-environment" aria-hidden="true">
          <div className="material-bloom material-bloom-a" />
          <div className="material-bloom material-bloom-b" />
          <div className="material-ribbon material-ribbon-a" />
          <div className="material-ribbon material-ribbon-b" />
          <div className="material-ribbon material-ribbon-c" />
          <div className="material-glaze" />
        </div>
        {children}
      </body>
    </html>
  );
}
