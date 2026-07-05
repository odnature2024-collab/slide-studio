import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ command }) => ({
  // GitHub Pages（https://<user>.github.io/slide-studio/）配下で動かすための base
  base: command === "build" ? "/slide-studio/" : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["demo-slides.html", "icons/apple-touch-icon.png"],
      manifest: {
        name: "スライドスタジオ — HTMLスライド編集",
        short_name: "スライドスタジオ",
        description: "HTMLスライドをパワーポイントのように直感的に編集できるエディタ",
        lang: "ja",
        display: "standalone",
        background_color: "#131417",
        theme_color: "#131417",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        // Google Fonts はランタイムキャッシュ（一度使えばオフラインでも表示）
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-css" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-files",
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    // iPad など同一ネットワークの端末からアクセスできるようにする
    host: true,
  },
  // vitest の設定
  test: {
    environment: "jsdom",
  },
}) as never);
