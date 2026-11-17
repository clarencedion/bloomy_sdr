import type { Metadata } from "next";
import "./globals.css";
import "./tables.css";
import { AuthProvider } from "@/lib/firebase/auth-context";


/**
 * A neutral fallback only. `WorkspaceBranding` replaces the title with the
 * business's own name once it loads, so what a customer sees in their tab is
 * their company, not the tool's.
 */
export const metadata: Metadata = {
  title: "SDR",
  description: "Autonomous prospecting."
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
