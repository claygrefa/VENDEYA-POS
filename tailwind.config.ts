import type { Config } from "tailwindcss";

const TONOS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;

/** Paleta cuyos tonos salen de variables CSS en formato «R G B» (admite opacidades como bg-slate-800/60) */
const paleta = (nombre: string): Record<string, string> =>
  Object.fromEntries(TONOS.map((t) => [t, `rgb(var(--c-${nombre}-${t}) / <alpha-value>)`]));

const config: Config = {
  content: [
    "./src/renderer/**/*.{ts,tsx,html}",
    "./src/renderer/index.html",
  ],
  theme: {
    extend: {
      colors: {
        // Paletas con variables CSS (src/renderer/styles/tema.css): el tema claro/oscuro cambia los valores sin tocar las clases.
        // `ink` es el color de texto principal (blanco en oscuro, casi negro en claro); sobre botones de color se sigue usando text-white.
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        slate: paleta("slate"),
        emerald: paleta("emerald"),
        red: paleta("red"),
        amber: paleta("amber"),
        sky: paleta("sky"),
        // Paleta VENDEYA POS
        brand: paleta("brand"),
        success: {
          50:  "#f0fdf4",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
        },
        warning: {
          50:  "#fffbeb",
          500: "#f59e0b",
          600: "#d97706",
        },
        danger: {
          50:  "#fef2f2",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
        },
        // Fondo oscuro para modo POS nocturno
        surface: paleta("slate"),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      screens: {
        // Pantallas táctiles industriales comunes en Ecuador
        touch: { raw: "(pointer: coarse)" },
      },
      animation: {
        "fade-in":    "fadeIn 150ms ease-in",
        "slide-up":   "slideUp 200ms ease-out",
        "pulse-once": "pulse 600ms ease-in-out 1",
      },
      keyframes: {
        fadeIn:  { from: { opacity: "0" },                to: { opacity: "1" } },
        slideUp: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};

export default config;
