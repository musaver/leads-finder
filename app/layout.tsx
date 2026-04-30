import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Finder",
  description: "Find businesses with no website or low-quality websites.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
