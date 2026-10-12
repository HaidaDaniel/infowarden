import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const typedFiles = [
  "apps/api/src/**/*.ts",
  "apps/mcp-server/src/**/*.ts",
  "apps/web/src/**/*.{ts,tsx}",
  "apps/web/e2e/**/*.ts",
  "apps/web/*.ts",
];

const typedRecommended = tseslint.configs.recommended.map((config) => ({
  ...config,
  files: typedFiles,
}));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      ".cache/**",
      ".contextforge/**",
      ".opencode/**",
      "apps/web/vite.config.js",
      "apps/web/vite.config.d.ts",
    ],
  },
  {
    files: ["scripts/**/*.mjs", ".husky/*.mjs", "*.config.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      eqeqeq: ["error", "always"],
      "no-duplicate-imports": "error",
      "no-fallthrough": "error",
      "prefer-const": "error",
    },
  },
  ...typedRecommended,
  {
    files: typedFiles,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["apps/web/e2e/*.ts", "apps/web/playwright.config.ts"],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ["error", "always"],
      "no-duplicate-imports": "error",
      "no-fallthrough": "error",
      "no-undef": "off",
      "prefer-const": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  eslintConfigPrettier,
);
