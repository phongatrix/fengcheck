import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dce7fe",
          500: "#3b6ef6",
          600: "#2456d9",
          700: "#1d44ad",
        },
      },
    },
  },
  plugins: [],
};

export default config;
