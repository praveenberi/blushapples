import { defineConfig } from 'vitest/config';
import os from 'os';
import path from 'path';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test', UPLOAD_DIR: path.join(os.tmpdir(), 'blush-apples-test-uploads'), DATABASE_URL: '' },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
