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

import type * as types from './types';

export function prune(conversation: types.Conversation) {
  // Replace all image results with empty text.
  for (const message of conversation.messages) {
    if (message.role === 'tool') {
      message.result.content = message.result.content.map(part => {
        if (part.type === 'image')
          return { type: 'text', text: '<pruned>' };
        return part;
      });
    }
  }
}
