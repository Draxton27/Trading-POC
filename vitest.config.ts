import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/phase19/**/*.test.ts','tests/phase41l/**/*.test.ts'],exclude:['tests/phase19-e2e/**'],maxWorkers:1}});
