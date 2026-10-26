import type { Metadata } from "next";
import { JetBrains_Mono, Onest } from "next/font/google";
import "./globals.css";

const onest = Onest({ variable: "--font-onest", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "app-builder",
  description: "Descreva um app em português e veja ele sendo construído.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${onest.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
