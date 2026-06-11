import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/.vite/**',
            '**/.vercel/**',
            '**/coverage/**',
            '**/migrations/**',
            'mockup/**',
            'pnpm-lock.yaml',
        ],
    },
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // Matches verbatimModuleSyntax: types must be imported with `import type`.
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
            ],
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            // Async correctness — high-value for the API + ingest pipeline.
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            // `async function` without an internal `await` is the conventional way
            // to declare a stub that satisfies a `Promise<T>` contract.
            '@typescript-eslint/require-await': 'off',
            // The codebase consistently uses `type` aliases. Enforce the existing style.
            '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
        },
    },
    {
        // Drizzle schema files use a builder API where the table-callback return
        // value is the column object — flagging it as a "confusing void expression"
        // would force noisy refactors of every schema file.
        files: ['packages/db/src/schema/**/*.ts'],
        rules: {
            '@typescript-eslint/no-confusing-void-expression': 'off',
        },
    },
    {
        // Config files at the repo root aren't covered by a workspace tsconfig.
        files: ['eslint.config.js', '*.config.{js,ts,mjs,cjs}'],
        ...tseslint.configs.disableTypeChecked,
    },
    prettier,
);
