import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "D-sektionen · Ekonomi",
  description: "Hantering av utlägg och ekonomi för D-sektionen",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
