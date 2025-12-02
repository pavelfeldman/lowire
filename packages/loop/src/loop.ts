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

import { getProvider } from './providers/registry';
import { cachedComplete } from './cache';
import type * as types from './types';

export type LoopOptions = types.CompletionOptions & {
  tools?: types.Tool[];
  callTool?: types.ToolCallback;
  maxTurns?: number;
  resultSchema?: types.Schema;
  cache?: {
    messages: types.ReplayCache;
    secrets: Record<string, string>;
  };
  summarize?: boolean;
};

export class Loop {
  private _provider: types.Provider;
  private _loopOptions: LoopOptions;
  private _cacheOutput: types.ReplayCache = {};

  constructor(loopName: 'openai' | 'github' | 'anthropic' | 'google', options: LoopOptions) {
    this._provider = getProvider(loopName);
    this._loopOptions = options;
  }

  async run<T>(task: string, runOptions: Omit<LoopOptions, 'model'> & { model?: string } = {}): Promise<T> {
    const options: LoopOptions = { ...this._loopOptions, ...runOptions };
    const allTools: types.Tool[] = [...options.tools || []];
    allTools.push({
      name: 'report_result',
      description: 'Report the result of the task.',
      inputSchema: options.resultSchema ?? defaultResultSchema,
    });

    const conversation: types.Conversation = {
      systemPrompt,
      messages: [
        { role: 'user', content: task },
      ],
      tools: allTools,
    };

    const debug = options.debug;
    const totalUsage: types.Usage = { input: 0, output: 0 };

    debug?.('lowire:loop')(`Starting ${this._provider.name} loop`, task);
    const maxTurns = options.maxTurns || 100;

    for (let turn = 0; turn < maxTurns; ++turn) {
      debug?.('lowire:loop')(`Turn ${turn + 1} of (max ${maxTurns})`);
      const caches = options.cache ? {
        input: options.cache.messages,
        output: this._cacheOutput,
        secrets: options.cache.secrets
      } : undefined;

      const summarizedConversation = options.summarize ? this._summarizeConversation(task, conversation) : conversation;
      debug?.('lowire:loop')(`Request`, JSON.stringify({ ...summarizedConversation, tools: `${summarizedConversation.tools.length} tools` }, null, 2));
      const { result: assistantMessage, usage } = await cachedComplete(this._provider, summarizedConversation, caches, options);
      const text = assistantMessage.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
      debug?.('lowire:loop')('Usage', `input: ${usage.input}, output: ${usage.output}`);
      debug?.('lowire:loop')('Assistant', text, JSON.stringify(assistantMessage.content, null, 2));

      totalUsage.input += usage.input;
      totalUsage.output += usage.output;
      conversation.messages.push(assistantMessage);

      const toolCalls = assistantMessage.content.filter(part => part.type === 'tool_call') as types.ToolCallContentPart[];
      if (toolCalls.length === 0) {
        assistantMessage.toolError = 'Error: tool call is expected in every assistant message. Call the "report_result" tool when the task is complete.';
        continue;
      }

      for (const toolCall of toolCalls) {
        const { name, arguments: args } = toolCall;

        debug?.('lowire:loop')('Call tool', name, JSON.stringify(args, null, 2));
        if (name === 'report_result')
          return args;

        try {
          const result = await options.callTool!({
            name,
            arguments: {
              ...args,
              _meta: {
                'dev.lowire/history': true,
                'dev.lowire/state': true,
              }
            }
          });
          const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
          debug?.('lowire:loop')('Tool result', text, JSON.stringify(result, null, 2));

          toolCall.result = result;
        } catch (error) {
          const errorMessage = `Error while executing tool "${name}": ${error instanceof Error ? error.message : String(error)}\n\nPlease try to recover and complete the task.`;
          debug?.('lowire:loop')('Tool error', errorMessage, String(error));

          toolCall.result = {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };

          // Skip remaining tool calls for this iteration
          for (const remainingToolCall of toolCalls.slice(toolCalls.indexOf(toolCall) + 1)) {
            remainingToolCall.result = {
              content: [{ type: 'text', text: `This tool call is skipped due to previous error.` }],
              isError: true,
            };
          }
          break;
        }
      }
    }

    if (options.summarize)
      return this._summarizeConversation(task, conversation) as any;
    throw new Error('Failed to perform step, max attempts reached');
  }

  private _summarizeConversation(task: string, conversation: types.Conversation): types.Conversation {
    const summary: string[] = ['## Task', task];
    const combinedState: Record<string, string> = {};

    const assistantMessages: types.AssistantMessage[] = conversation.messages.filter(message => message.role === 'assistant');
    for (let turn = 0; turn < assistantMessages.length - 1; ++turn) {
      if (turn === 0) {
        summary.push('');
        summary.push('## History');
      }

      const message = assistantMessages[turn];
      summary.push(``);
      summary.push(`### Turn ${turn + 1}`);

      for (const part of message.content) {
        if (part.type === 'text') {
          summary.push(`[assistant] ${part.text}`);
          continue;
        }

        if (part.type === 'tool_call') {
          summary.push(`[tool_call] ${part.name}(${JSON.stringify(part.arguments)})`);
          if (part.result) {
            for (const [name, state] of Object.entries(part.result._meta?.['dev.lowire/state'] || {}))
              combinedState[name] = state;
            summary.push(`[tool_result]`);
            this._toolResultHistory(part.result, summary);
          }
          continue;
        }
      }

      if (message.toolError)
        summary.push(`[error] ${message.toolError}`);
    }

    const lastMessage: types.AssistantMessage | undefined = assistantMessages[assistantMessages.length - 1];
    if (lastMessage) {
      // Remove state from combined state as it'll be a part of the last assistant message.
      for (const part of lastMessage.content.filter(part => part.type === 'tool_call')) {
        for (const name of Object.keys(part.result?._meta?.['dev.lowire/state'] || {}))
          delete combinedState[name];
      }
    }

    for (const [name, state] of Object.entries(combinedState))
      summary.push(`### ${name}\n${state}`);

    // eslint-disable-next-line no-console
    console.log(`
============================================================
${summary.join('\n')}
------------------------------------------------------------
${JSON.stringify(lastMessage, null, 2)}`);

    return {
      ...conversation,
      messages: [
        { role: 'user', content: summary.join('\n') },
        ...lastMessage ? [lastMessage] : [],
      ],
    };
  }

  private _toolResultHistory(toolResult: types.ToolResult, summary: string[]) {
    for (const item of toolResult._meta?.['dev.lowire/history'] || [])
      summary.push(`<${item.category}>${item.content}</${item.category}>`);
    if (toolResult.isError)
      summary.push(`- error: ${toolResult.content.filter(part => part.type === 'text').map(part => part.text).join('\n')}`);
  }

  cache(): types.ReplayCache {
    return this._cacheOutput;
  }
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

const systemPrompt = `
You are an autonomous agent designed to complete tasks by interacting with tools. Perform the user task.
`;
