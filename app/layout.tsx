import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MLE certification practice",
  description: "MLE certification practice questions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
