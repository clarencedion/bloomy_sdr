import type { Metadata } from "next";
import "./globals.css";
import "./tables.css";
import { AuthProvider } from "@/lib/firebase/auth-context";


export const metadata: Metadata = {
  title: "Devcomm Sales OS",
  description: "AI-powered B2B sales operating system for Devcomm."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
