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

import { OpenAI } from './providers/openai';
import { Copilot } from './providers/copilot';
import { Claude } from './providers/claude';

import type * as types from './types';

export type RunLoopOptions = {
  tools?: types.Tool[];
  callTool?: (params: { name: string, arguments: any}) => Promise<types.ToolResult>;
  maxTurns?: number;
  resultSchema?: types.Schema;
  logger?: types.Logger;
};

export class Loop {
  private _provider: types.Provider;

  constructor(loopName: 'openai' | 'copilot' | 'claude' = 'openai') {
    this._provider = getProvider(loopName);
  }

  async run<T>(task: string, options: RunLoopOptions = {}): Promise<T> {
    return runLoop<T>(this._provider, task, options);
  }
}

async function runLoop<T>(provider: types.Provider, task: string, options: RunLoopOptions = {}): Promise<T> {
  const taskContent = `Perform following task: ${task}. Once the task is complete, call the "report_result" tool.`;
  const allTools: types.Tool[] = [
    ...(options.tools ?? []),
    {
      name: 'report_result',
      description: 'Report the result of the task.',
      inputSchema: options.resultSchema ?? defaultResultSchema,
    },
  ];

  const conversation: types.Conversation = {
    messages: [{
      role: 'user',
      content: taskContent,
    }],
    tools: allTools,
  };

  const log = options.logger || (() => {});
  log('loop:loop', `Starting ${provider.name} loop`, taskContent);
  const maxTurns = options.maxTurns || 100;
  for (let iteration = 0; iteration < maxTurns; ++iteration) {
    log('loop:turn', `${iteration + 1} of (max ${maxTurns})`);
    const { result: assistantMessage, usage } = await provider.complete(conversation);

    conversation.messages.push(assistantMessage);
    const { content, toolCalls } = assistantMessage;

    log('loop:usage', `input: ${usage.input}, output: ${usage.output}`);
    log('loop:assistant', content, JSON.stringify(toolCalls, null, 2));

    if (toolCalls.length === 0) {
      conversation.messages.push({
        role: 'user',
        content: `Tool call expected. Call the "report_result" tool when the task is complete.`,
      });
      continue;
    }

    const toolResults: Array<{ toolCallId: string; result: types.ToolResult }> = [];
    for (const toolCall of toolCalls) {
      const { name, arguments: args, id } = toolCall;

      log('loop:call-tool', name, JSON.stringify(args, null, 2));
      if (name === 'report_result')
        return args;

      try {
        const result = await options.callTool!({
          name,
          arguments: args,
        });

        const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
        log('loop:tool-result', text, JSON.stringify(result, null, 2));

        toolResults.push({
          toolCallId: id,
          result,
        });
      } catch (error) {
        const errorMessage = `Error while executing tool "${name}": ${error instanceof Error ? error.message : String(error)}\n\nPlease try to recover and complete the task.`;
        log('loop:tool-error', errorMessage, String(error));

        toolResults.push({
          toolCallId: id,
          result: {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          }
        });

        // Skip remaining tool calls for this iteration
        for (const remainingToolCall of toolCalls.slice(toolCalls.indexOf(toolCall) + 1)) {
          toolResults.push({
            toolCallId: remainingToolCall.id,
            result: {
              content: [{ type: 'text', text: `This tool call is skipped due to previous error.` }],
              isError: true,
            }
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

function getProvider(loopName: 'openai' | 'copilot' | 'claude'): types.Provider {
  if (loopName === 'openai')
    return new OpenAI();
  if (loopName === 'copilot')
    return new Copilot();
  if (loopName === 'claude')
    return new Claude();
  throw new Error(`Unknown loop LLM: ${loopName}`);
}

const defaultResultSchema: types.Schema = {
  type: 'object',
  properties: {
    result: {
      type: 'string',
    },
  },
  required: ['result'],
};
