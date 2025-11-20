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

import colors from 'colors';
import debug from 'debug';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

import type { Tool, ImageContent, TextContent, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type * as llm from './llm';

/* eslint-disable no-console */

type RunLoopOptions = {
  tools: Tool[];
  maxTurns?: number;
  callTool: (params: { name: string, arguments: any}) => Promise<CallToolResult>;
  resultSchema: z.ZodSchema<any>;
};

export async function runLoop<T>(llm: llm.LLM, task: string, options: RunLoopOptions): Promise<T> {
  const taskContent = `Perform following task: ${task}. Once the task is complete, call the "report_result" tool.`;
  const inputSchema = resultSchemaWithFallback(options.resultSchema);
  const allTools: Tool[] = [
    ...options.tools,
    {
      name: 'report_result',
      description: 'Report the result of the task.',
      inputSchema,
    },
  ];

  const conversation: llm.Conversation = {
    messages: [{
      role: 'user',
      content: taskContent,
    }],
    tools: allTools,
  };

  log('loop:loop', 'Starting loop', taskContent);
  const maxTurns = options.maxTurns || 100;
  for (let iteration = 0; iteration < maxTurns; ++iteration) {
    log('loop:turn', `${iteration + 1} of ${maxTurns}`);
    const assistantMessage = await llm.complete(conversation);

    conversation.messages.push(assistantMessage);
    const { content, toolCalls } = assistantMessage;

    log('loop:usage', `input: ${llm.usage.inputTokens}, output: ${llm.usage.outputTokens}`);
    log('loop:assistant', content, JSON.stringify(toolCalls, null, 2));

    if (toolCalls.length === 0) {
      conversation.messages.push({
        role: 'user',
        content: `Tool call expected. Call the "report_result" tool when the task is complete.`,
      });
      continue;
    }

    const toolResults: Array<{ toolCallId: string; content: string; isError?: boolean }> = [];
    for (const toolCall of toolCalls) {
      const { name, arguments: args, id } = toolCall;

      log('loop:call-tool', name, JSON.stringify(args, null, 2));
      if (name === 'report_result')
        return args;

      try {
        const response = await options.callTool({
          name,
          arguments: args,
        });

        const responseContent = (response.content || []) as (TextContent | ImageContent)[];
        const text = responseContent.filter(part => part.type === 'text').map(part => part.text).join('\n');
        log('loop:tool-result', '', text);

        toolResults.push({
          toolCallId: id,
          content: text,
        });
      } catch (error) {
        const errorMessage = `Error while executing tool "${name}": ${error instanceof Error ? error.message : String(error)}\n\nPlease try to recover and complete the task.`;
        log('loop:tool-error', errorMessage, String(error));

        toolResults.push({
          toolCallId: id,
          content: errorMessage,
          isError: true,
        });

        // Skip remaining tool calls for this iteration
        for (const remainingToolCall of toolCalls.slice(toolCalls.indexOf(toolCall) + 1)) {
          toolResults.push({
            toolCallId: remainingToolCall.id,
            content: `This tool call is skipped due to previous error.`,
            isError: true,
          });
        }
        break;
      }
    }

    for (const toolResult of toolResults) {
      conversation.messages.push({
        role: 'tool',
        ...toolResult,
      });
    }
  }

  throw new Error('Failed to perform step, max attempts reached');
}

function log(category: string, text: string, details: string = '') {
  debug(category)(text, colors.dim(details));

  const trimmedText = trim(text, 100);
  const trimmedDetails = trim(details, 100 - trimmedText.length - 1);
  console.log(colors.bold(colors.green(category)), trimmedText, colors.dim(trimmedDetails));
}

function trim(text: string, maxLength: number) {
  if (text.length <= maxLength)
    return text;
  return text.slice(0, maxLength - 3) + '...';
}

function resultSchemaWithFallback(resultSchema: any): any {
  if (resultSchema)
    return zodToJsonSchema(resultSchema);

  return {
    type: 'object',
    description: 'Result of the task.',
    properties: {
      result: {
        type: 'string',
        description: 'The result of the task as a string.',
      },
    },
    required: ['result'],
  };
}
