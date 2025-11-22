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

import { OpenAI } from './openai';

import type { Endpoint } from './openai';

type CopilotTokenResponse = {
  token: string;
};

export const kEditorHeaders = {
  'Editor-Version': 'vscode/1.96.0',
  'Editor-Plugin-Version': 'copilot-chat/0.24.0',
  'User-Agent': 'GitHubCopilotChat/0.24.0',
  'Accept': 'application/json',
  'Content-Type': 'application/json'
};

export class Copilot extends OpenAI {
  override readonly name = 'copilot';
  override async connect(): Promise<Endpoint> {
    return {
      model: 'claude-sonnet-4.5',
      baseUrl: 'https://api.githubcopilot.com',
      apiKey: await getCopilotToken(),
      headers: kEditorHeaders
    };
  }
}

async function getCopilotToken(): Promise<string> {
  const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
    method: 'GET',
    headers: { 'Authorization': `token ${process.env.COPILOT_API_KEY}`, ...kEditorHeaders }
  });
  const data = await response.json() as CopilotTokenResponse;
  if (data.token)
    return data.token;
  throw new Error('Failed to get Copilot token');
}
