import eslintConfigNode from "@dextinity/eslint-config/nestjs.js";
import eslintConfigReact from "@dextinity/eslint-config/react.js";
import { defineConfig, globalIgnores } from "eslint/config";

const config = defineConfig([
    globalIgnores(["data/**", "frontend/dist/**", "package-lock.json"]),
    {
        files: ["**/*.json"],
        extends: [eslintConfigNode],
    },
    {
        files: ["src/**/*.ts"],
        extends: [eslintConfigNode],
    },
    {
        files: ["*.{js,mjs}"],
        extends: [eslintConfigNode],
        rules: {
            "import/no-extraneous-dependencies": ["error", { devDependencies: true }],
        },
    },
    {
        files: ["frontend/**/*.{ts,tsx}"],
        extends: [eslintConfigReact],
        rules: {
            // The frontend uses plain mui and has no translations, unlike a Dextinity admin.
            "@calm/react-intl/missing-formatted-message": "off",
            "formatjs/enforce-default-message": "off",
            "formatjs/enforce-placeholders": "off",
            "react/jsx-no-literals": "off",
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        { name: "react", importNames: ["default"] },
                        { name: "@mui/material", importNames: ["styled"], message: "Please use styled from @mui/material/styles instead." },
                    ],
                },
            ],
        },
    },
    {
        files: ["**/*.{js,mjs,ts,tsx}"],
        languageOptions: {
            parserOptions: {
                // Config files outside of a tsconfig.json: the vite config is in frontend/tsconfig.node.json.
                projectService: { allowDefaultProject: ["*.js", "*.mjs", "frontend/vite.config.ts"] },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
]);

export default config;
