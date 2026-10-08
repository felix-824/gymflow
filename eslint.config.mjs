import eslint from '@eslint/js';
import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import prettier from 'eslint-plugin-prettier/recommended';

// Use the installed parser/plugin directly; preserve the intended type-checked rule set.
export default [
 {
  ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
 },
 {
  files: ['apps/**/*.ts'],
  languageOptions: {
   parser,
   globals: { ...globals.node, ...globals.jest },
   parserOptions: {
    sourceType: 'module',
    ecmaVersion: 'latest',
    project: ['./tsconfig.json'],
    tsconfigRootDir: process.cwd(),
   },
  },
  plugins: { '@typescript-eslint': plugin },
  rules: {
   ...eslint.configs.recommended.rules,
   ...plugin.configs['eslint-recommended'].overrides[0].rules,
   ...plugin.configs['recommended-type-checked'].rules,
   '@typescript-eslint/no-explicit-any': 'off',
   '@typescript-eslint/no-floating-promises': 'warn',
   '@typescript-eslint/no-unsafe-argument': 'warn',
  },
 },
 {
  ...prettier,
  files: ['apps/**/*.ts'],
  rules: { ...prettier.rules, 'prettier/prettier': ['error', { endOfLine: 'auto' }] },
 },
];
