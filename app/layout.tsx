import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tee24 App",
  description: "To manage bookings and reservations.",
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
