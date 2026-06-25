import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sa: {
          orange: "hsl(var(--sa-orange))",
          "orange-glow": "hsl(var(--sa-orange-glow))",
          blue: "hsl(var(--sa-blue))",
          "blue-deep": "hsl(var(--sa-blue-deep))",
          grey: "hsl(var(--sa-grey))",
          "grey-soft": "hsl(var(--sa-grey-soft))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 10px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.55", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.06)" },
        },
        "armed-pulse": {
          // Self-contained breathing ring: 2px white offset gap (contrast on
          // any button color) + an orange ring that expands 5px->8px. Drives
          // box-shadow directly, so it needs no Tailwind ring beneath it.
          "0%, 100%": { boxShadow: "0 0 0 2px hsl(0 0% 100%), 0 0 0 5px hsl(var(--sa-orange) / 0.9)" },
          "50%": { boxShadow: "0 0 0 2px hsl(0 0% 100%), 0 0 0 8px hsl(var(--sa-orange) / 0.35)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      fontFamily: {
        display: ['"Bebas Neue"', "Inter", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "glow-pulse": "glow-pulse 2.4s ease-in-out infinite",
        "armed-pulse": "armed-pulse 1.6s ease-in-out infinite",
        "pop-in": "pop-in 200ms var(--ease-out-quint)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
