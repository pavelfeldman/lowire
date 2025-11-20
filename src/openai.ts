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

import type * as openai from 'openai';
import type * as llm from './llm';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export class OpenAI implements llm.LLM {
  private _openai: openai.OpenAI | undefined;
  readonly usage: llm.Usage = { inputTokens: 0, outputTokens: 0 };

  async openai(): Promise<openai.OpenAI> {
    if (!this._openai)
      this._openai = await this.createOpenAI();
    return this._openai;
  }

  async createOpenAI(): Promise<openai.OpenAI> {
    const oai = await import('openai');
    return new oai.OpenAI();
  }

  model(): string {
    return 'gpt-4.1';
  }

  headers(): Record<string, string> | undefined {
    return undefined;
  }

  async complete(conversation: llm.Conversation): Promise<llm.AssistantMessage> {
    // Convert generic messages to OpenAI format
    const openaiMessages = toOpenAIMessages(conversation.messages);
    const openaiTools = conversation.tools.map(toOpenAITool);

    const api = await this.openai();
    const response = await api.chat.completions.create({
      model: this.model(),
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: conversation.tools.length > 0 ? 'auto' : undefined
    }, { headers: this.headers() });

    this.usage.inputTokens += response.usage?.prompt_tokens ?? 0;
    this.usage.outputTokens += response.usage?.completion_tokens ?? 0;

    const message = response.choices[0].message;

    const openaiToolCalls = message.tool_calls || [];
    const toolCalls = openaiToolCalls.map(toToolCall);

    return {
      role: 'assistant',
      content: message.content || '',
      toolCalls
    };
  }
}

function toOpenAIMessages(messages: llm.Message[]): openai.OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const openaiMessages: openai.OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      openaiMessages.push({
        role: 'user',
        content: message.content
      });
      continue;
    }

    if (message.role === 'assistant') {
      const toolCalls: openai.OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];

      if (message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          toolCalls.push({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments)
            }
          });
        }
      }

      const assistantMessage: openai.OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: 'assistant'
      };

      if (message.content)
        assistantMessage.content = message.content;

      if (toolCalls.length > 0)
        assistantMessage.tool_calls = toolCalls;

      openaiMessages.push(assistantMessage);
      continue;
    }

    if (message.role === 'tool') {
      openaiMessages.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      });
      continue;
    }
  }

  return openaiMessages;
}

function toOpenAITool(tool: Tool): openai.OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function toToolCall(toolCall: openai.OpenAI.Chat.Completions.ChatCompletionMessageToolCall): llm.ToolCall {
  return {
    name: toolCall.type === 'function' ? toolCall.function.name : toolCall.custom.name,
    arguments: JSON.parse(toolCall.type === 'function' ? toolCall.function.arguments : toolCall.custom.input),
    id: toolCall.id,
  };
}
