import type { Metadata } from "next";
import { Geist_Mono, Jost } from "next/font/google";
import "./globals.css";
import "./pearl-theme.css";
import "./immersive-material.css";
import "./workbench.css";

const jost = Jost({ variable: "--font-atelier", subsets: ["latin"], weight: ["300", "400", "500"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Archeagent | Evidence-first AI software delivery",
  description:
    "Private local workbench for inspecting reported patch evaluations and independent engineering checks. Operational Concord recording remains held at its storage-isolation gate.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="darkreader-lock" content="true" />
        <script dangerouslySetInnerHTML={{ __html: 'try { document.documentElement.dataset.theme = localStorage.getItem("archeagent-appearance") === "light" ? "light" : "dark"; } catch (_) { document.documentElement.dataset.theme = "dark"; }' }} />
      </head>
      <body className={`${jost.variable} ${geistMono.variable} workbench-theme`}>
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
