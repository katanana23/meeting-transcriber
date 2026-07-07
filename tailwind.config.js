/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(240 10% 4%)",
        foreground: "hsl(0 0% 98%)",
        card: "hsl(240 10% 8%)",
        border: "hsl(240 6% 16%)",
        muted: "hsl(240 5% 55%)",
        primary: "hsl(0 0% 98%)",
        accent: "hsl(24 70% 55%)",
        me: "hsl(200 80% 60%)",
        them: "hsl(140 55% 55%)"
      },
      borderRadius: { lg: "12px", md: "10px", sm: "8px" }
    }
  },
  plugins: []
};
