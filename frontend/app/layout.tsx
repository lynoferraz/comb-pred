import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "./lib/context";
import Header from "./components/Header";

export const metadata: Metadata = {
  title: "CIM - Combinatorial Information Markets",
  description: "Prediction market powered by Cartesi",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#fafbfc] text-slate-900 font-sans selection:bg-blue-600 selection:text-white">
        <AppProvider>
          <Header />
          <main className="max-w-[1400px] mx-auto px-8 py-8">{children}</main>
        </AppProvider>
      </body>
    </html>
  );
}
