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

export class CachingProvider implements types.Provider {
  readonly name: string;
  private _provider: types.Provider;
  private _caches: types.ReplayCaches;

  constructor(provider: types.Provider, caches: types.ReplayCaches) {
    this.name = provider.name;
    this._provider = provider;
    this._caches = caches;
  }

  async complete(conversation: types.Conversation) {
    const key = conversationHash(conversation);
    if (this._caches.before[key]) {
      this._caches.after[key] = this._caches.before[key];
      return this._caches.before[key] ?? this._caches.after[key];
    }
    if (this._caches.after[key])
      return this._caches.after[key];
    const result = await this._provider.complete(conversation);
    this._caches.after[key] = result;
    return result;
  }
}

function conversationHash(conversation: types.Conversation): string {
  return calculateSha1(JSON.stringify(conversation));
}

function calculateSha1(buffer: Buffer | string): string {
  const hash = crypto.createHash('sha1');
  hash.update(buffer);
  return hash.digest('hex');
}
