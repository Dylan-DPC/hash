/** @type {import("eslint").Linter.Config} */
module.exports = {
  ...require("@local/eslint-config/generate-workspace-config.cjs")(__dirname),
  rules: {
    "jsx-a11y/label-has-associated-control": "off",
    "import/no-default-export": "error",
  },
  overrides: [
    {
      files: [
        "./src/pages/**/*.page.ts",
        "./src/pages/**/*.page.tsx",
        "**/__mocks__/**",
        "*.stories.ts",
        "*.stories.tsx",
      ],
      rules: {
        "import/no-default-export": "off",
      },
    },
  ],
};