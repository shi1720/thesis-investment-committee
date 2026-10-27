import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Thesis: Conviction, with a counterargument.",
  description:
    "An evidence-first investment research committee. Explore global opportunities, define your risk limits, and understand what could change your mind.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
