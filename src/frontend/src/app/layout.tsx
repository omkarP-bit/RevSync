import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RevSync",
  description: "Quote-to-Cash orchestration platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
