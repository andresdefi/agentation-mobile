/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				neutral: {
					50: "rgb(var(--n-50) / <alpha-value>)",
					100: "rgb(var(--n-100) / <alpha-value>)",
					200: "rgb(var(--n-200) / <alpha-value>)",
					300: "rgb(var(--n-300) / <alpha-value>)",
					400: "rgb(var(--n-400) / <alpha-value>)",
					500: "rgb(var(--n-500) / <alpha-value>)",
					600: "rgb(var(--n-600) / <alpha-value>)",
					700: "rgb(var(--n-700) / <alpha-value>)",
					800: "rgb(var(--n-800) / <alpha-value>)",
					900: "rgb(var(--n-900) / <alpha-value>)",
					950: "rgb(var(--n-950) / <alpha-value>)",
				},
			},
		},
	},
	plugins: [],
};
