import { configDefaults } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-plugin';

const poolOptions = {
  miniflare: {
    compatibilityDate: '2026-11-02',
    d1Databases: ['ADMIN_DB'],
  },
};

export default {
  plugins: [cloudflareTest(poolOptions)],
  test: {
    include: ['worker/test/**/*.test.ts'],
    exclude: [...configDefaults.exclude],
    pool: cloudflarePool(poolOptions),
  },
};
