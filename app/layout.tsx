import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Friend Quiz",
  description: "A small local quiz app for friends.",
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
