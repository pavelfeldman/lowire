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

import { fetchWithTimeout } from '../fetchWithTimeout';

import type * as openai from 'openai';
import type * as types from '../types';
import type { ReasoningEffort } from 'openai/resources/shared';

export class OpenAICompatible implements types.Provider {
  readonly name: string = 'openai-compatible';

  async complete(conversation: types.Conversation, options: types.CompletionOptions) {
    return complete(conversation, options);
  }
}

async function complete(conversation: types.Conversation, options: types.CompletionOptions) {
  // Convert generic messages to OpenAI format
  const systemMessage: openai.OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
    role: 'system',
    content: systemPrompt(conversation.systemPrompt)
  };
  const openaiMessages = [systemMessage, ...conversation.messages.map(toCompletionsMessages).flat()];
  const openaiTools = conversation.tools.map(t => toCompletionsTool(t));

  const response = await create({
    model: options.model,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
    messages: openaiMessages,
    tools: openaiTools,
    tool_choice: conversation.tools.length > 0 ? 'auto' : undefined,
    reasoning_effort: toCompletionsReasoning(options.reasoning),
    parallel_tool_calls: false,
  }, options);

  if (!response || !response.choices.length)
    throw new Error('Failed to get response from OpenAI completions');

  const result: types.AssistantMessage = { role: 'assistant', content: [] };
  for (const choice of response.choices) {
    const message = choice.message;
    if (message.content)
      result.content.push({ type: 'text', text: message.content });
    for (const entry of message.tool_calls || []) {
      if (entry.type !== 'function')
        continue;
      result.content.push(toToolCall(entry));
    }
  }

  const usage: types.Usage = {
    input: response.usage?.prompt_tokens ?? 0,
    output: response.usage?.completion_tokens ?? 0,
  };
  return { result, usage };
}

async function create(createParams: openai.OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, options: types.CompletionOptions): Promise<openai.OpenAI.Chat.Completions.ChatCompletion> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${options.apiKey}`,
  };

  const debugBody = { ...createParams, tools: `${createParams.tools?.length ?? 0} tools` };
  options.debug?.('lowire:openai')('Request:', JSON.stringify(debugBody, null, 2));

  const response = await fetchWithTimeout(options.apiEndpoint ?? `https://api.openai.com/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(createParams),
    signal: options.signal,
    timeout: options.apiTimeout
  });

  if (!response.ok) {
    options.debug?.('lowire:openai')('Response:', response.status);
    throw new Error(`API error: ${response.status} ${response.statusText} ${await response.text()}`);
  }

  const responseBody = await response.json() as openai.OpenAI.Chat.Completions.ChatCompletion;
  options.debug?.('lowire:openai')('Response:', JSON.stringify(responseBody, null, 2));
  return responseBody;
}

function toCopilotResultContentPart(part: types.ResultPart): openai.OpenAI.Chat.Completions.ChatCompletionContentPart {
  if (part.type === 'text') {
    return {
      type: 'text',
      text: part.text,
    };
  }
  if (part.type === 'image') {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${part.mimeType};base64,${part.data}`,
      },
    };
  }
  throw new Error(`Cannot convert content part of type ${(part as any).type} to text content part`);
}

function toCompletionsMessages(message: types.Message): openai.OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (message.role === 'user') {
    return [{
      role: 'user',
      content: message.content
    }];
  }

  if (message.role === 'assistant') {
    const assistantMessage: openai.OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
      role: 'assistant'
    };

    const textParts = message.content.filter(part => part.type === 'text') as types.TextContentPart[];
    const toolCallParts = message.content.filter(part => part.type === 'tool_call');
    if (textParts.length === 1)
      assistantMessage.content = textParts[0].text;
    else
      assistantMessage.content = textParts;

    const toolCalls: openai.OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
    const toolResultMessages: openai.OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    for (const toolCall of toolCallParts) {
      toolCalls.push({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments)
        }
      });
      if (toolCall.result) {
        toolResultMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolCall.result.content.map(toCopilotResultContentPart) as openai.OpenAI.Chat.Completions.ChatCompletionContentPartText[],
        });
      }
    }

    if (toolCalls.length > 0)
      assistantMessage.tool_calls = toolCalls;

    if (message.toolError) {
      toolResultMessages.push({
        role: 'user',
        content: [{
          type: 'text',
          text: message.toolError,
        }]
      });
    }

    return [assistantMessage, ...toolResultMessages];
  }

  throw new Error(`Unsupported message role: ${(message as any).role}`);
}

function toCompletionsTool(tool: types.Tool): openai.OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function toToolCall(entry: openai.OpenAI.Chat.Completions.ChatCompletionMessageToolCall): types.ToolCallContentPart {
  return {
    type: 'tool_call',
    name: entry.type === 'function' ? entry.function.name : entry.custom.name,
    arguments: JSON.parse(entry.type === 'function' ? entry.function.arguments : entry.custom.input),
    id: entry.id,
  };
}

function toCompletionsReasoning(reasoning: 'none' | 'medium' | 'high' | undefined): ReasoningEffort | undefined {
  switch (reasoning) {
    case 'none':
      return 'none';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
  }
}

const systemPrompt = (prompt: string) => `
### System instructions

${prompt}

### Tool calling instructions
- Make sure every message contains a tool call.
- When you use a tool, you may provide a brief thought or explanation in the content field
  immediately before the tool_call. Do not split this into separate messages.
- Every reply must include a tool call.
`;
