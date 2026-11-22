import type { Metadata, Viewport } from "next";
import { Caveat, DM_Sans, Fraunces, Lora, Literata, Source_Serif_4 } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { HymnoraProvider } from "@/components/hymnora-provider";
import { AppCharmProvider } from "@/lib/i18n";
import "./globals.css";

const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], display: "swap" });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], display: "swap" });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], display: "swap" });
const literata = Literata({ variable: "--font-literata-face", subsets: ["latin"], display: "swap" });
const lora = Lora({ variable: "--font-lora-face", subsets: ["latin"], display: "swap" });
/*
 * One script face, for one word. The builder's name sits under Settings in the
 * rail, and a hand is the only thing that reads as a signature — an italic serif
 * reads as emphasis, which is not the same thing.
 */
const signature = Caveat({ variable: "--font-signature-face", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Hymnora SDA — The SDA Digital Platform", template: "%s · Hymnora SDA" },
  description: "A digital home for SDA worship, media, churches, news, Bible study, events and community activities.",
  applicationName: "Hymnora SDA",
  keywords: ["SDA", "Adventist", "hymns", "worship", "sermons", "Bible", "church directory"],
  manifest: "/manifest.json",
  // `appleWebApp` is what makes an iOS Home Screen install eligible for push:
  // Safari ignores the web app manifest for notifications, so without these
  // `apple-mobile-web-app-capable` tags a reminder can never reach an iPhone.
  appleWebApp: { capable: true, title: "Hymnora", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4efe4" },
    { media: "(prefers-color-scheme: dark)", color: "#1f1e19" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // The inline script below writes `data-theme` (and `lang` for some readers)
      // before React hydrates, by design, so the server markup and the first
      // client pass legitimately differ here. Without this, React logs a
      // hydration mismatch on every page load and cannot patch the attribute.
      suppressHydrationWarning
      // Lets Next know the smooth scrolling in globals.css is intentional.
      data-scroll-behavior="smooth"
      className={`${dmSans.variable} ${fraunces.variable} ${sourceSerif.variable} ${literata.variable} ${lora.variable} ${signature.variable}`}
    >
      <body>
        {/*
          Paint the saved theme before the first frame so a Dusk reader is never
          flashed a cream page. The resolved leaf (never "system") goes on <html
          data-theme>, the same key globals.css overrides its variables on, and
          the html lang is set before content exists so screen readers start on
          the right voice. The React provider repeats this in rect-safe form,
          which keeps a choice made in one tab from surprising another.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var k="hymnora.theme",t=localStorage.getItem(k),o=["light","warm","dark","sanctuary","garden","sunset","midnight","system"];t=o.indexOf(t)>-1?t:"warm";if(t==="system"){t=matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t;var l=localStorage.getItem("hymnora.lang"),c={English:"en",Kiswahili:"sw",French:"fr",Spanish:"es"};if(l&&c[l]){document.documentElement.lang=c[l]}}catch(e){}`,
          }}
        />
        <HymnoraProvider>
          <AppCharmProvider>
            <AppShell>{children}</AppShell>
          </AppCharmProvider>
        </HymnoraProvider>
      </body>
    </html>
  );
}
