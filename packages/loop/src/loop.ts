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
import { summarizeConversation } from './summary';

import type * as types from './types';
type PromiseOrValue<T> = T | Promise<T>;

export type LoopEvents = {
  onBeforeTurn?: (params: {
    conversation: types.Conversation;
    totalUsage: types.Usage;
    budgetTokens?: number;
  }) => PromiseOrValue<void>;
  onAfterTurn?: (params: {
    assistantMessage: types.AssistantMessage;
    totalUsage: types.Usage;
    budgetTokens?: number;
  }) => PromiseOrValue<void>;
  onBeforeToolCall?: (params: {
    assistantMessage: types.AssistantMessage;
    toolCall: types.ToolCallContentPart;
  }) => PromiseOrValue<'disallow' | void>;
  onAfterToolCall?: (params: {
    assistantMessage: types.AssistantMessage;
    toolCall: types.ToolCallContentPart;
    result: types.ToolResult;
  }) => PromiseOrValue<'disallow' | void>;
  onToolCallError?: (params: {
    assistantMessage: types.AssistantMessage;
    toolCall: types.ToolCallContentPart;
    error: Error;
  }) => PromiseOrValue<void>;
};

export type LoopOptions = types.CompletionOptions & LoopEvents & {
  tools?: types.Tool[];
  callTool?: types.ToolCallback;
  maxTurns?: number;
  maxToolCalls?: number;
  maxToolCallRetries?: number;
  cache?: types.ReplayCache;
  secrets?: Record<string, string>;
  summarize?: boolean;
};

export class Loop {
  private _provider: types.Provider;
  private _loopOptions: LoopOptions;
  private _cacheOutput: types.ReplayCache = {};

  constructor(options: LoopOptions) {
    this._provider = getProvider(options.api);
    this._loopOptions = options;
  }

  async run(task: string, runOptions: Omit<LoopOptions, 'model' | 'api' | 'apiKey'> & { model?: string; abortController?: AbortController } = {}): Promise<{
    result?: types.ToolResult;
    status: 'ok' | 'break' | 'error',
    error?: string,
    usage: types.Usage,
    turns: number,
  }> {
    const options: LoopOptions = { ...this._loopOptions, ...runOptions };
    const abortController = runOptions.abortController;
    const allTools: types.Tool[] = [...(options.tools || []).map(wrapToolWithIsDone)];

    const conversation: types.Conversation = {
      systemPrompt,
      messages: [
        { role: 'user', content: task },
      ],
      tools: allTools,
    };

    const debug = options.debug;
    const budget = {
      tokens: options.maxTokens,
      toolCalls: options.maxToolCalls,
      toolCallRetries: options.maxToolCallRetries,
    };
    const totalUsage: types.Usage = { input: 0, output: 0 };

    debug?.('lowire:loop')(`Starting ${this._provider.name} loop\n${task}`);
    const maxTurns = options.maxTurns || 100;

    for (let turns = 0; turns < maxTurns; ++turns) {
      if (options.maxTokens && budget.tokens !== undefined && budget.tokens <= 0)
        return { status: 'error', error: `Budget tokens ${options.maxTokens} exhausted`, usage: totalUsage, turns };

      debug?.('lowire:loop')(`Turn ${turns + 1} of (max ${maxTurns})`);
      const caches = options.cache ? {
        input: options.cache,
        output: this._cacheOutput,
      } : undefined;

      const summarizedConversation = options.summarize ? this._summarizeConversation(task, conversation, options) : conversation;
      await options.onBeforeTurn?.({ conversation: summarizedConversation, totalUsage, budgetTokens: budget.tokens });
      if (abortController?.signal.aborted)
        return { status: 'break', usage: totalUsage, turns };

      debug?.('lowire:loop')(`Request`, JSON.stringify({ ...summarizedConversation, tools: `${summarizedConversation.tools.length} tools` }, null, 2));
      const tokenEstimate = Math.floor(JSON.stringify(summarizedConversation).length / 4);
      if (budget.tokens !== undefined && tokenEstimate >= budget.tokens)
        return { status: 'error', error: `Input token estimate ${tokenEstimate} exceeds budget ${budget.tokens}`, usage: totalUsage, turns };

      const { result: assistantMessage, usage } = await cachedComplete(this._provider, summarizedConversation, caches, {
        ...options,
        maxTokens: budget.tokens !== undefined ? budget.tokens - tokenEstimate : undefined,
        signal: abortController?.signal,
      });

      if (assistantMessage.stopReason.code === 'error')
        return { status: 'error', error: assistantMessage.stopReason.message, usage: totalUsage, turns };

      if (assistantMessage.stopReason.code === 'max_tokens')
        return { status: 'error', error: `Max tokens exhausted`, usage: totalUsage, turns };

      const intent = assistantMessage.content.filter(part => part.type === 'text').map(part => part.text).join('\n');

      totalUsage.input += usage.input;
      totalUsage.output += usage.output;
      if (budget.tokens !== undefined)
        budget.tokens -= usage.input + usage.output;

      debug?.('lowire:loop')('Usage', `input: ${usage.input}, output: ${usage.output}`);
      debug?.('lowire:loop')('Assistant', intent, JSON.stringify(assistantMessage.content, null, 2));
      await options.onAfterTurn?.({ assistantMessage, totalUsage, budgetTokens: budget.tokens });
      if (abortController?.signal.aborted)
        return { status: 'break', usage: totalUsage, turns };

      conversation.messages.push(assistantMessage);
      const toolCalls = assistantMessage.content.filter(part => part.type === 'tool_call') as types.ToolCallContentPart[];
      if (toolCalls.length === 0) {
        assistantMessage.toolError = 'Error: tool call is expected in every assistant message. Call the "report_result" tool when the task is complete.';
        continue;
      }

      for (const toolCall of toolCalls) {
        if (budget.toolCalls !== undefined && --budget.toolCalls < 0)
          return { status: 'error', error: `Failed to perform step, max tool calls (${options.maxToolCalls}) reached`, usage: totalUsage, turns };

        const { name, arguments: args } = toolCall;
        debug?.('lowire:loop')('Call tool', name, JSON.stringify(args, null, 2));

        const status = await options.onBeforeToolCall?.({ assistantMessage, toolCall });
        if (abortController?.signal.aborted)
          return { status: 'break', usage: totalUsage, turns };
        if (status === 'disallow') {
          toolCall.result = {
            content: [{ type: 'text', text: 'Tool call is disallowed.' }],
            isError: true,
          };
          continue;
        }

        try {
          const result = await options.callTool!({
            name,
            arguments: {
              ...args,
              _meta: {
                'dev.lowire/intent': intent,
                'dev.lowire/history': true,
                'dev.lowire/state': true,
              }
            }
          });
          const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
          debug?.('lowire:loop')('Tool result', text, JSON.stringify(result, null, 2));

          const status = await options.onAfterToolCall?.({ assistantMessage, toolCall, result });
          if (abortController?.signal.aborted)
            return { status: 'break', usage: totalUsage, turns };
          if (status === 'disallow') {
            toolCall.result = {
              content: [{ type: 'text', text: 'Tool result is disallowed to be reported.' }],
              isError: true,
            };
            continue;
          }

          toolCall.result = result;
          if (args._is_done && !result.isError)
            return { result, status: 'ok', usage: totalUsage, turns };
        } catch (error) {
          const errorMessage = `Error while executing tool "${name}": ${error instanceof Error ? error.message : String(error)}\n\nPlease try to recover and complete the task.`;
          await options.onToolCallError?.({ assistantMessage, toolCall, error });
          if (abortController?.signal.aborted)
            return { status: 'break', usage: totalUsage, turns };

          toolCall.result = {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      }

      const hasErrors = toolCalls.some(toolCall => toolCall.result?.isError);
      if (!hasErrors)
        budget.toolCallRetries = options.maxToolCallRetries;

      if (hasErrors && budget.toolCallRetries !== undefined && --budget.toolCallRetries < 0)
        return { status: 'error', error: `Failed to perform action after ${options.maxToolCallRetries} tool call retries`, usage: totalUsage, turns };
    }

    return { status: 'error', error: `Failed to perform step, max attempts reached`, usage: totalUsage, turns: maxTurns };
  }

  private _summarizeConversation(task: string, conversation: types.Conversation, options: LoopOptions): types.Conversation {
    const { summary, lastMessage } = summarizeConversation(task, conversation, options);
    return {
      ...conversation,
      messages: [
        { role: 'user', content: summary },
        ...lastMessage ? [lastMessage] : [],
      ],
    };
  }

  cache(): types.ReplayCache {
    return this._cacheOutput;
  }
}

function wrapToolWithIsDone(tool: types.Tool): types.Tool {
  const inputSchema = { ...tool.inputSchema };
  inputSchema.properties = {
    ...inputSchema.properties,
    _is_done: { type: 'boolean', description: 'Whether the task is complete. If false, agentic loop will continue to perform the task.' },
  };
  inputSchema.required = [...(inputSchema.required || []), '_is_done'];
  return {
    ...tool,
    inputSchema,
  };
}

const systemPrompt = `
- You are an autonomous agent designed to complete tasks by interacting with tools.
- Perform the user task.
- If you see text surrounded by %, it is a secret and you should preserve it as such. It will be replaced with the actual value before the tool call.
`;
