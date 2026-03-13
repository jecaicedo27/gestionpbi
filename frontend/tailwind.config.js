/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: {
                    50: '#f0f9ff',
                    500: '#0ea5e9',
                    600: '#0284c7',
                },
                danger: {
                    50: '#fef2f2',
                    500: '#ef4444',
                },
                success: {
                    50: '#f0fdf4',
                    500: '#22c55e',
                },
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            }
        },
    },
    plugins: [],
}
