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
import debug from 'debug';

import { test as baseTest } from '@playwright/test';
import { Loop, LoopOptions } from '../lib/loop';
import { TestServer } from './testServer';

import type * as types from '../src/types';

export { expect } from '@playwright/test';

export type TestOptions = {
  api: 'openai' | 'anthropic' | 'google';
  apiKey: string;
  apiEndpoint?: string;
  apiVersion?: string;
  model: string;
  reasoning?: 'none' | 'medium' | 'high';
};

type TestFixtures = {
  loop: Loop;
  server: TestServer;
};

type WorkerFixtures = {
  _workerPort: number;
  _workerServer: TestServer;
};

export const test = baseTest.extend<TestOptions & TestFixtures, WorkerFixtures>({
  api: ['openai', { option: true }],
  apiKey: ['', { option: true }],
  apiEndpoint: [undefined, { option: true }],
  apiVersion: [undefined, { option: true }],
  model: ['', { option: true }],
  reasoning: ['none', { option: true }],
  loop: async ({ api, apiKey, apiEndpoint, apiVersion, _workerPort, model, reasoning }, use, testInfo) => {
    const cacheFile = path.join(__dirname, '__cache__', testInfo.project.name, sanitizeFileName(test.info().titlePath.join(' ')) + '.json');
    const dataBefore = await fs.promises.readFile(cacheFile, 'utf-8').catch(() => '{}');
    let cache: types.ReplayCache = {};
    try {
      cache = JSON.parse(dataBefore) as types.ReplayCache;
    } catch {
      cache = {};
    }
    const loop = new Loop({
      api,
      apiEndpoint,
      apiKey,
      apiVersion,
      model,
      reasoning,
      cache: { messages: cache, secrets: { PORT: String(_workerPort) } },
      debug,
    });
    await use(loop);
    const dataAfter = JSON.stringify(loop.cache(), null, 2);
    if (dataBefore !== dataAfter) {
      await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.promises.writeFile(cacheFile, dataAfter);
    }
  },

  _workerPort: [async ({ }, use, workerInfo) => {
    const port = 8907 + workerInfo.workerIndex * 2;
    await use(port);
  }, { scope: 'worker' }],

  _workerServer: [async ({ _workerPort }, use) => {
    const server = await TestServer.create(_workerPort);
    await use(server);
    await server.stop();
  }, { scope: 'worker' }],

  server: async ({ _workerServer }, use) => {
    _workerServer.reset();
    await use(_workerServer);
  },
});

function sanitizeFileName(name: string): string {
  return name.replace('.spec.ts', '').replace(/[^a-zA-Z0-9_]+/g, '-');
}

export async function runLoop<T>(loop: Loop, task: string, options: Omit<LoopOptions, 'model' | 'api' | 'apiKey'> & { resultSchema?: types.Schema, model?: string } = {}): Promise<{ result?: T, usage: types.Usage, turns: number, status: 'ok' | 'break' }> {
  const tools: types.Tool[] = [
    ...options.tools || [],
    {
      name: 'report_result',
      description: 'Report the result of the task.',
      inputSchema: options.resultSchema ?? { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] },
    },
  ];
  const callTool: types.ToolCallback = async (params: { name: string, arguments: any }) => {
    if (params.name === 'report_result')
      return { content: [{ type: 'text', text: JSON.stringify(params.arguments) }] };
    return options.callTool!(params);
  };
  const response = await loop.run(task + '\nCall "report_result" tool to report the result.', { ...options, tools, callTool });
  const part = response.result?.content.find(part => part.type === 'text');
  const result = part ? JSON.parse(part.text) : undefined;
  if (result) {
    for (const key of Object.keys(result)) {
      if (key.startsWith('_'))
        delete result[key];
    }
  }
  return {
    ...response,
    result,
  };
}
