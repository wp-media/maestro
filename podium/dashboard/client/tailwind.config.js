/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#0a0e14",
          1: "#0f1318",
          2: "#151921",
          3: "#1c2433",
          4: "#243048",
          5: "#2e3a50",
        },
        border: {
          DEFAULT: "#2e3243",
          light: "#3a4d68",
        },
        accent: {
          DEFAULT: "#fed23a",
          hover: "#e0bb35",
          muted: "rgba(254,210,58,0.15)",
        },
      },
      fontFamily: {
        sans: ["'Whitney HTF Medium'", "'Inter'", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["'JetBrains Mono'", "'Fira Code'", "Consolas", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
