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

import dotenv from 'dotenv';
import debug from 'debug';
import * as loop from '@lowire/loop';

dotenv.config({ quiet: true });

async function main() {
  const { tools, callTool, close } = await loop.createMcpTools({
    playwright: {
      command: 'npx',
      args: ['playwright', 'run-mcp-server', '--isolated'],
      cwd: process.cwd(),
      stderr: 'pipe',
    }
  }, {
    rootDir: process.cwd()
  });

    const ll = new loop.Loop('github', {
    model: 'claude-sonnet-4.5',
    tools,
    callTool,
  });

  const result = await ll.run('Navigate to https://demo.playwright.dev/todomvc/ and perform acceptance testing of the functionality', {
    debug,
  });
  console.log(result);
  await close();
}

void main();
