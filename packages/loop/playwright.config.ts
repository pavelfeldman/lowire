import path from 'path';
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

import { TestOptions } from './tests/fixtures';

dotenv.config({ quiet: true });

export default defineConfig<TestOptions>({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'azure-sonnet',
      use: {
        api: 'anthropic',
        apiKey: process.env.AZURE_SONNET_API_KEY,
        apiEndpoint: process.env.AZURE_SONNET_ENDPOINT,
        model: 'claude-sonnet-4-5',
      }
    },
    {
      name: 'openai-completions',
      use: {
        api: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        apiVersion: 'v1/chat/completions',
        model: 'gpt-5.2',
      }
    },
    {
      name: 'openai-responses',
      use: {
        api: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        apiVersion: 'v1/responses',
        model: 'gpt-5.2',
      }
    },
    {
      name: 'claude',
      use: {
        api: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: 'claude-sonnet-4-5',
      }
    },
    {
      name: 'gemini',
      use: {
        api: 'google',
        apiKey: process.env.GEMINI_API_KEY,
        model: 'gemini-2.5-flash',
      }
    },
  ],
});
