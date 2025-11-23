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

import crypto from 'crypto';
import * as types from './types';

export function cachedComplete(provider: types.Provider, caches: types.ReplayCaches): types.Provider['complete'] {
  return async (conversation: types.Conversation) => {
    const key = conversationHash(conversation);
    if (caches.before[key]) {
      caches.after[key] = caches.before[key];
      return caches.before[key] ?? caches.after[key];
    }
    if (caches.after[key])
      return caches.after[key];
    const result = await provider.complete(conversation);
    caches.after[key] = result;
    return result;
  };
}

function conversationHash(conversation: types.Conversation): string {
  return calculateSha1(JSON.stringify(conversation));
}

function calculateSha1(text: string): string {
  text = text.replace(/localhost:\d+/g, 'localhost:PORT');
  const hash = crypto.createHash('sha1');
  hash.update(text);
  return hash.digest('hex');
}
