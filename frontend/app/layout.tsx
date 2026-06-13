import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "./lib/context";
import { ThemeProvider, themeInitScript } from "./lib/theme";
import { ToastProvider } from "./components/ui/Toast";
import Header from "./components/Header";
import DisclaimerBanner from "./components/DisclaimerBanner";

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
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-bg text-ink font-sans selection:bg-accent selection:text-white antialiased">
        <ThemeProvider>
          <ToastProvider>
            <AppProvider>
              <Header />
              <DisclaimerBanner />
              <main>{children}</main>
            </AppProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
