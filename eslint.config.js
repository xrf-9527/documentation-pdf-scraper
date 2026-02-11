import js from "@eslint/js";
import globals from "globals";
import json from "@eslint/json";
import { defineConfig } from "eslint/config";


export default defineConfig([
  { files: ["**/*.{js,mjs,cjs}"], plugins: { js }, extends: ["js/recommended"] },
  { files: ["**/*.{js,mjs,cjs}"], languageOptions: { globals: {...globals.browser, ...globals.node} } },
  {
    files: ["tests/**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: { "no-unused-vars": "off" },
  },
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  { files: ["**/*.json"], plugins: { json }, language: "json/json", extends: ["json/recommended"] },
]);
