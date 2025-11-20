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

// @ts-check

const dotenv = require('dotenv');
const { copilot } = require('./index');

dotenv.config({ quiet: true });

async function main() {
  /** @type {import('./index').Conversation} */
  const conversation = {
    messages: [{ role: 'user', content: 'Write a short poem about the sea.' }],
    tools: [],
  };
  const model = copilot();
  console.log(await model.complete(conversation));
}

void main();
