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
import { assistantMessageFromError, emptyUsage } from '../types';

import type * as google from '@google/generative-ai';
import type * as types from '../types';

type GeminiThinkingPart = google.Part & { thoughtSignature?: string };

export class Google implements types.Provider {
  readonly name = 'google';

  async complete(conversation: types.Conversation, options: types.CompletionOptions) {
    const contents = conversation.messages.map(toGeminiContent).flat();
    const { response, error } = await create(options.model ?? 'gemini-2.5-pro', {
      systemInstruction: {
        role: 'system',
        parts: [
          { text: systemPrompt(conversation.systemPrompt) }
        ]
      },
      contents,
      tools: conversation.tools.length > 0 ? [{ functionDeclarations: conversation.tools.map(toGeminiTool) }] : undefined,
      generationConfig: {
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens
      },
    }, options);

    const [candidate] = response?.candidates ?? [];
    if (error || !response || !candidate)
      return { result: assistantMessageFromError(error ?? 'No response from Google API'), usage: emptyUsage() };

    const usage: types.Usage = {
      input: response.usageMetadata?.promptTokenCount ?? 0,
      output: response.usageMetadata?.candidatesTokenCount ?? 0,
    };

    const result = toAssistantMessage(candidate);
    return { result, usage };
  }
}

async function create(model: string, createParams: google.GenerateContentRequest, options: types.CompletionOptions): Promise<{ response?: google.GenerateContentResponse, error?: string }> {
  const debugBody = { ...createParams, tools: `${createParams.tools?.length ?? 0} tools` };
  options.debug?.('lowire:google')('Request:', JSON.stringify(debugBody, null, 2));

  const response = await fetchWithTimeout(options.apiEndpoint ?? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': options.apiKey,
    },
    body: JSON.stringify(createParams),
    signal: options.signal,
    timeout: options.apiTimeout
  });

  if (!response.ok) {
    options.debug?.('lowire:google')('Response:', response.status);
    return { error: `API error: ${response.status} ${response.statusText} ${await response.text()}` };
  }

  const responseBody = await response.json() as google.GenerateContentResponse;
  options.debug?.('lowire:google')('Response:', JSON.stringify(responseBody, null, 2));
  return { response: responseBody };
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
  delete cleaned.$schema;
  for (const key in cleaned) {
    if (cleaned[key] && typeof cleaned[key] === 'object')
      cleaned[key] = stripUnsupportedSchemaFields(cleaned[key]);
  }
  return cleaned;
}

function toAssistantMessage(candidate: google.GenerateContentCandidate): types.AssistantMessage {
  const stopReason: types.AssistantMessage['stopReason'] = { code: 'ok' };
  if (candidate.finishReason === 'MAX_TOKENS')
    stopReason.code = 'max_tokens';

  return {
    role: 'assistant',
    content: (candidate.content.parts || []).map(toContentPart).filter(Boolean) as (types.TextContentPart | types.ToolCallContentPart)[],
    stopReason,
  };
}

function toContentPart(part: google.Part & { thoughtSignature?: string }): types.TextContentPart | types.ToolCallContentPart | null {
  if (part.text) {
    return {
      type: 'text',
      text: part.text,
      googleThoughtSignature: part.thoughtSignature,
    };
  }

  if (part.functionCall) {
    return {
      type: 'tool_call',
      name: part.functionCall.name,
      arguments: part.functionCall.args,
      id: `call_${Math.random().toString(36).substring(2, 15)}`,
      googleThoughtSignature: part.thoughtSignature,
    };
  }

  return null;
}

function toGeminiContent(message: types.Message): google.Content[] {
  if (message.role === 'user') {
    return [{
      role: 'user',
      parts: [{ text: message.content }]
    }];
  }

  if (message.role === 'assistant') {
    const parts: GeminiThinkingPart[] = [];
    const toolResults: google.Content[] = [];

    for (const part of message.content) {
      if (part.type === 'text') {
        parts.push({
          text: part.text,
          thoughtSignature: part.googleThoughtSignature,
        });
        continue;
      }

      if (part.type === 'tool_call') {
        parts.push({
          functionCall: {
            name: part.name,
            args: part.arguments
          },
          thoughtSignature: part.googleThoughtSignature,
        });
        if (part.result)
          toolResults.push(...toGeminiToolResult(part, part.result));
      }
    }

    if (message.toolError) {
      toolResults.push({
        role: 'user',
        parts: [{
          text: message.toolError,
        }]
      });
    }

    return [{
      role: 'model',
      parts
    }, ...toolResults];
  }

  throw new Error(`Unsupported message role: ${(message as any).role}`);
}

function toGeminiToolResult(call: types.ToolCallContentPart, toolResult: types.ToolResult): google.Content[] {
  const responseContent: any = {};
  const textParts: string[] = [];
  const inlineDatas: any[] = [];

  for (const part of toolResult.content) {
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

  const result: google.Content[] = [{
    role: 'function',
    parts: [{
      functionResponse: {
        name: call.name,
        response: responseContent
      }
    }]
  }];

  if (inlineDatas.length > 0) {
    result.push({
      role: 'user',
      parts: inlineDatas
    });
  }
  return result;
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
