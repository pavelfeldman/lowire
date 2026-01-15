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

import { test, expect, runLoop } from './fixtures';
import type * as types from '../lib/types';

const defaultPromptTokens = 186;

test('should respect max tokens', async ({ createLoop }) => {
  const loop = createLoop({ maxTokens: defaultPromptTokens + 20 });
  const response = await runLoop(loop, 'This is a test, reply with just "Hello world"');
  expect(response.status).toBe('error');
  expect(response.error).toBe('Max tokens exhausted');
});

test('should respect max tokens (insufficient input)', async ({ createLoop }) => {
  const loop = createLoop({ maxTokens: defaultPromptTokens - 20 });
  const response = await runLoop(loop, 'This is a test, reply with just "Hello world"');
  expect(response.status).toBe('error');
  expect(response.error).toBe('Input token estimate 186 exceeds budget 166');
});

test('should respect max tokens below 16', async ({ createLoop }) => {
  test.skip(test.info().project.name !== 'openai', 'OpenAI responses does not support max tokens below 16');
  const loop = createLoop({ maxTokens: defaultPromptTokens + 10 });
  const response = await runLoop(loop, 'This is a test, reply with just "Hello world"');
  expect(response.status).toBe('error');
  expect(response.error).toContain('integer below minimum value. Expected a value >= 16, but got 10 instead.');
});

test('should respect max tool calls', async ({ createLoop }) => {
  const loop = createLoop({ maxToolCalls: 3 });

  const tools: types.Tool[] = [pushTool];
  const callTool: types.ToolCallback = async () => { return { content: [] }; };

  const response = await runLoop(loop, 'Run numbers 1, 2, 3, 4 and 5', { tools, callTool });
  expect(response.status).toBe('error');
  expect(response.error).toBe('Failed to perform step, max tool calls (3) reached');
});

test('should respect max tool call retries', async ({ createLoop }) => {
  const loop = createLoop({ maxToolCallRetries: 2 });

  const tools: types.Tool[] = [pushTool];
  const callTool: types.ToolCallback = async () => {
    return {
      content: [
        { type: 'text', text: 'Could not push value at this time, please try again.' },
      ],
      isError: true,
    };
  };

  const response = await runLoop(loop, 'Use the tool push to push the number 1.', { tools, callTool, omitReportResult: true });
  expect(response.status).toBe('error');
  expect(response.error).toBe('Failed to perform action after 2 tool call retries');
});

const pushTool: types.Tool = {
  name: 'push',
  description: 'Push a value to the stack.',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'number', description: 'The value to push to the stack' } },
    required: ['value'],
  },
};
