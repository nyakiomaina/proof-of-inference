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
      fontFamily: {
        mono: ['"JetBrains Mono"', "Menlo", "Monaco", "monospace"],
      },
    },
  },
  plugins: [],
};
