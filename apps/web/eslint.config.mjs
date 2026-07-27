import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next, restated because declaring any
    // globalIgnores replaces them.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright + QA artefacts. Generated, never source.
    "test-results/**",
    "playwright-report/**",
  ]),
  {
    rules: {
      // SYSTEM-PROMPT §2.13: no `any` without a justifying comment. ESLint
      // cannot check for the comment, so the rule is an error and the comment
      // is enforced in review.
      "@typescript-eslint/no-explicit-any": "error",
      // CONVENTIONS §3: verbatimModuleSyntax needs type-only imports marked.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // SYSTEM-PROMPT §2.7: the service-role key never reaches the browser.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/supabase/admin", "**/lib/supabase/service-role"],
              message:
                "Service-role client is server-only. Import it from a route handler or server module, never from components/.",
            },
          ],
        },
      ],
    },
  },
])

export default eslintConfig
