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

import { Anthropic } from './anthropic';
import { Google } from './google';
import { OpenAI } from './openai';
import { OpenAICompatible } from './openaiCompatible';

import type * as types from '../types';

export function getProvider(api: 'openai' | 'openai-compatible' | 'anthropic' | 'google'): types.Provider {
  if (api === 'openai')
    return new OpenAI();
  if (api === 'openai-compatible')
    return new OpenAICompatible();
  if (api === 'anthropic')
    return new Anthropic();
  if (api === 'google')
    return new Google();
  throw new Error(`Unknown loop LLM: ${api}`);
}
