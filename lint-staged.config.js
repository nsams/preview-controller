export default {
    "*.{ts,tsx,js,mjs,json}": "eslint --max-warnings 0 --no-warn-ignored",
    "*.{md,yml,yaml,html,css}": "prettier --check",
    "{src,frontend}/**/*.{ts,tsx}": () => ["npm run lint:tsc", "npm run lint:tsc-frontend", "npm run lint:knip"],
};
