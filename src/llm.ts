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

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type ToolCall = {
  name: string;
  arguments: any;
  id: string;
};

export type UserMessage = {
  role: 'user';
  content: string;
};

export type AssistantMessage = {
  role: 'assistant';
  content: string;
  toolCalls: ToolCall[];
};

export type ToolResultMessage = {
  role: 'tool';
  toolCallId: string;
  content: string;
  isError?: boolean;
};

export type Message =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;

export type Conversation = {
  messages: Message[];
  tools: Tool[];
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
};

export interface LLM {
  readonly usage: Usage;
  complete(conversation: Conversation): Promise<AssistantMessage>;
}
