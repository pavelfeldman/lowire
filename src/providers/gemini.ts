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

import type * as gemini from '@google/generative-ai';
import type * as types from '../types';

const model = 'gemini-2.5-pro';

export class Gemini implements types.Provider {
  readonly name = 'gemini';
  readonly systemPrompt = systemPrompt;

  async complete(conversation: types.Conversation) {
    const response = await create({
      contents: toGeminiMessages(conversation.messages),
      tools: conversation.tools.length > 0 ? [{ functionDeclarations: conversation.tools.map(toGeminiTool) }] : undefined,
    });

    const firstCandidate = response.candidates?.[0];
    if (!firstCandidate)
      throw new Error('No candidates in response');

    const textContent = firstCandidate.content.parts
        .filter(part => 'text' in part)
        .map(part => part.text)
        .join('');

    const toolCalls = firstCandidate.content.parts
        .filter(part => 'functionCall' in part)
        .map(toToolCall);

    const result: types.AssistantMessage = {
      role: 'assistant',
      content: textContent,
      toolCalls,
    };
    const usage: types.Usage = {
      input: response.usageMetadata?.promptTokenCount ?? 0,
      output: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
    return { result, usage };
  }
}

async function create(body: gemini.GenerateContentRequest): Promise<gemini.GenerateContentResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    throw new Error('GEMINI_API_KEY environment variable is required');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body)
  });

  if (!response.ok)
    throw new Error(`API error: ${response.status} ${response.statusText} ${await response.text()}`);

  return await response.json() as gemini.GenerateContentResponse;
}

function toGeminiTool(tool: types.Tool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: stripUnsupportedSchemaFields(tool.inputSchema) as any,
  };
}

function stripUnsupportedSchemaFields(schema: any): any {
  if (!schema || typeof schema !== 'object')
    return schema;

  const cleaned: any = Array.isArray(schema) ? [...schema] : { ...schema };
  delete cleaned.additionalProperties;
  for (const key in cleaned) {
    if (cleaned[key] && typeof cleaned[key] === 'object')
      cleaned[key] = stripUnsupportedSchemaFields(cleaned[key]);
  }
  return cleaned;
}

function toToolCall(part: gemini.Part): types.ToolCall {
  if (!('functionCall' in part))
    throw new Error('Expected functionCall part');

  const functionCall = part.functionCall as gemini.FunctionCall;
  return {
    name: functionCall.name,
    arguments: functionCall.args,
    id: `call_${Math.random().toString(36).substring(2, 15)}`,
  };
}

function toGeminiMessages(messages: types.Message[]): gemini.Content[] {
  const geminiMessages: gemini.Content[] = [];

  for (const message of messages) {
    if (message.role === 'user' || message.role === 'system') {
      geminiMessages.push({
        role: 'user',
        parts: [{ text: message.content }]
      });
      continue;
    }

    if (message.role === 'assistant') {
      const parts: gemini.Part[] = [];

      // Add text content
      if (message.content) {
        parts.push({
          text: message.content,
        });
      }

      // Add tool calls
      if (message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          parts.push({
            functionCall: {
              name: toolCall.name,
              args: toolCall.arguments
            }
          });
        }
      }

      geminiMessages.push({
        role: 'model',
        parts
      });

      continue;
    }

    if (message.role === 'tool') {
      // Find the corresponding function call to get the tool name
      // We need to look back in messages to find the assistant message with this toolCallId
      let toolName = 'unknown';
      for (let i = messages.indexOf(message) - 1; i >= 0; i--) {
        const prevMsg = messages[i];
        if (prevMsg.role === 'assistant' && prevMsg.toolCalls) {
          const matchingCall = prevMsg.toolCalls.find(tc => tc.id === message.toolCallId);
          if (matchingCall) {
            toolName = matchingCall.name;
            break;
          }
        }
      }

      // Convert tool result content to a response object
      const responseContent: any = {};

      // Handle all content parts using toGeminiContentPart
      const textParts: string[] = [];
      const inlineDatas: any[] = [];

      for (const part of message.result.content) {
        if (part.type === 'text') {
          textParts.push(part.text);
        } else if (part.type === 'image') {
          // Store image data for inclusion in response
          inlineDatas.push({
            inline_data: {
              mime_type: part.mimeType,
              data: part.data
            }
          });
        }
      }

      if (textParts.length > 0)
        responseContent.result = textParts.join('\n');

      geminiMessages.push({
        role: 'function',
        parts: [{
          functionResponse: {
            name: toolName,
            response: responseContent
          }
        }]
      });

      if (inlineDatas.length > 0) {
        geminiMessages.push({
          role: 'user',
          parts: inlineDatas
        });
      }

      continue;
    }
  }

  return geminiMessages;
}

const systemPrompt = `
- Make sure every message contains a tool call.
- When you use a tool, you may provide a brief thought or explanation in the content field
  immediately before the tool_call. Do not split this into separate messages.
- Every reply must include a tool call.
`;
