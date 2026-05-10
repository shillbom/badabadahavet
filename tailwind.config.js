/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Fraunces'", "ui-serif", "Georgia", "serif"],
        sans: [
          "'Inter'",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      colors: {
        wave: {
          50: "#eff9ff",
          100: "#def1ff",
          200: "#b6e4ff",
          300: "#76d0ff",
          400: "#2bb8ff",
          500: "#019eea",
          600: "#007ec6",
          700: "#0264a0",
          800: "#065684",
          900: "#0b486d",
        },
      },
      keyframes: {
        bob: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        ripple: {
          "0%": { transform: "scale(0.6)", opacity: "0.6" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
      },
      animation: {
        bob: "bob 3s ease-in-out infinite",
        ripple: "ripple 1.6s ease-out infinite",
      },
    },
  },
  plugins: [],
};
