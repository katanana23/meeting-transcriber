/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0c0c0f",
        foreground: "#f0f0f5",
        card:       "#17171c",
        "card-2":   "#1e1e25",
        border:     "rgba(255,255,255,0.07)",
        muted:      "#7a7a8a",
        primary:    "#f0f0f5",
        me:         "#28c96a",
        them:       "#7c7af5",
      },
      borderRadius: {
        sm:   "8px",
        md:   "12px",
        lg:   "16px",
        xl:   "20px",
        "2xl": "24px",
        "3xl": "32px",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "monospace"],
      },
      boxShadow: {
        card: "0 2px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
        bento: "0 4px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)",
      },
      animation: {
        "pulse-dot": "pulse-dot 1.8s ease-in-out infinite",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.3" },
        },
      },
    },
  },
  plugins: [],
};
