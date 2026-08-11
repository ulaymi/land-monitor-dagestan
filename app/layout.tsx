import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://land-monitor-dagestan.alex-manko.chatgpt.site";
const socialImage = `${siteUrl}/og.png`;
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "LandMonitor · Деградация земель Дагестана",
  description:
    "Спутниковый мониторинг деградации земель, дефицита влаги и оголения почв в Республике Дагестан.",
  openGraph: {
    title: "LandMonitor · Дагестан",
    description:
      "Интерактивная карта риска опустынивания и приоритетных зон наблюдения.",
    images: [{ url: socialImage, width: 1731, height: 909 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LandMonitor · Дагестан",
    description: "Где земля теряет устойчивость.",
    images: [socialImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        <link
          crossOrigin=""
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <Script
          id="leaflet"
          src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
          strategy="beforeInteractive"
        />
        <Script
          id="satellite-data"
          src={`${publicBasePath}/satellite-data.js`}
          strategy="afterInteractive"
          type="module"
        />
      </body>
    </html>
  );
}
