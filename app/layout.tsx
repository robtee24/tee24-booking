import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tee24 Indoor Golf Center", template: "%s · Tee24" },
  description: "Book a bay, manage your membership and unlock the door — Tee24 Indoor Golf Center.",
  applicationName: "Tee24",
  // Icons come from app/favicon.ico, app/icon.png, app/apple-icon.png and app/opengraph-image.png (Next file conventions).
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
