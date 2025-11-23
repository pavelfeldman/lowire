import path from 'path';
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

import { TestOptions } from './tests/fixtures';

dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });

export default defineConfig<TestOptions>({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'copilot',
      use: {
        provider: 'copilot',
      }
    },
    {
      name: 'openai',
      use: {
        provider: 'openai',
      }
    },
    {
      name: 'claude',
      use: {
        provider: 'claude',
      }
    },
  ],
});
