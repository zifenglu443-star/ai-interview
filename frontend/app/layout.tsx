import type { Metadata } from "next";
import AppErrorBoundary from "./AppErrorBoundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Interview Simulator",
  description: "An immersive AI interview simulator.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppErrorBoundary>{children}</AppErrorBoundary>
      </body>
    </html>
  );
}
