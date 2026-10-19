import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/phase19/**/*.test.ts'],exclude:['tests/phase19-e2e/**']}});
