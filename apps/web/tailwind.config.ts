import type { Config } from "tailwindcss";

/**
 * Tsugu — kintsugi design system. Deep warm sumi-ink lacquer, mended with gold.
 * Gold is the seam: it marks proof, progress, and payout.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0807",
          900: "#0f0d0a",
          850: "#15120d",
          800: "#1b1711",
          700: "#241f17",
          600: "#322a1f",
          500: "#473c2c",
        },
        gold: {
          200: "#f7e7bd",
          300: "#f0d493",
          400: "#e6bd6a",
          500: "#d8a64a", // primary
          600: "#c08833",
          700: "#9a6a22",
          800: "#6e4a16",
        },
        porcelain: {
          DEFAULT: "#f4efe6",
          muted: "#cfc7b8",
          dim: "#9a9080",
          faint: "#6c6456",
        },
        jade: "#9bd6ae",
        rust: "#d97a4e",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "Cambria", "serif"],
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        gold: "0 0 0 1px rgba(216,166,74,0.25), 0 18px 50px -22px rgba(216,166,74,0.45)",
        seam: "0 0 18px -2px rgba(216,166,74,0.55)",
        panel: "0 24px 64px -32px rgba(0,0,0,0.8)",
      },
      backgroundImage: {
        "gold-grad": "linear-gradient(100deg, #6e4a16 0%, #d8a64a 30%, #f7e7bd 50%, #d8a64a 70%, #9a6a22 100%)",
        "gold-soft": "linear-gradient(180deg, #e6bd6a 0%, #c08833 100%)",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        seamDraw: {
          "0%": { strokeDashoffset: "1" },
          "100%": { strokeDashoffset: "0" },
        },
        goldPulse: {
          "0%,100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both",
        "gold-pulse": "goldPulse 1.8s ease-in-out infinite",
        shimmer: "shimmer 3.5s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
