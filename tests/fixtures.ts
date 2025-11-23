/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import path from 'path';

import { test as baseTest } from '@playwright/test';
import { Loop } from '../lib/loop';
export { expect } from '@playwright/test';

import type * as types from '../src/types';

export type TestOptions = {
  provider: 'openai' | 'copilot' | 'claude';
};

export type TestFixtures = {
  loop: Loop;
};

export const test = baseTest.extend<TestOptions & TestFixtures>({
  provider: ['copilot', { option: true }],
  loop: async ({ provider }, use) => {
    const cacheFile = path.join(__dirname, '__cache__', sanitizeFileName(test.info().titlePath.join(' ')) + '.json');
    const dataBefore = await fs.promises.readFile(cacheFile, 'utf-8').catch(() => '{}');
    let cache: types.ReplayCache = {};
    try {
      cache = JSON.parse(dataBefore) as types.ReplayCache;
    } catch {
      cache = {};
    }
    const caches: types.ReplayCaches = { before: cache, after: {} };
    await use(new Loop(provider, { caches }));
    const dataAfter = JSON.stringify(caches.after, null, 2);
    if (dataBefore !== dataAfter) {
      await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.promises.writeFile(cacheFile, JSON.stringify(caches.after, null, 2));
    }
  }
});

function sanitizeFileName(name: string): string {
  return name.replace('.spec.ts', '').replace(/[^a-zA-Z0-9_]+/g, '-');
}
