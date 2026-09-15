/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/frontend/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        solana: {
          purple: "#9945FF",
          green: "#14F195",
        },
      },
      // Declared here, not just in index.css: `font-sans` / `font-mono` are
      // utility classes, so they outrank any `@layer base` element rule. With
      // only a `body { font-family: Inter }` base rule the `font-sans` on
      // <body> won and Inter was fetched but never rendered.
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ['"JetBrains Mono"', "Menlo", "Monaco", "monospace"],
      },
    },
  },
  plugins: [],
};
