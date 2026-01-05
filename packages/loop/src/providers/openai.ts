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


import { complete as completionsApi } from './openaiCompletions';
import { complete as responsesApi } from './openaiResponses';

import type * as types from '../types';

export class OpenAI implements types.Provider {
  readonly name: string = 'openai';

  async complete(conversation: types.Conversation, options: types.CompletionOptions) {
    if (options.apiVersion === 'v1/chat/completions')
      return completionsApi(conversation, options);
    return responsesApi(conversation, options);
  }
}
