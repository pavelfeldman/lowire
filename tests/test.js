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

const fs = require('fs');
const path = require('path');
const colors = require('colors');
const dotenv = require('dotenv');
const debug = require('debug');

const { Loop } = require('../index');

dotenv.config({ quiet: true });

const provider = 'copilot';

/**
 * @param {string} category 
 * @param {string} text 
 * @param {string} details 
 */
function logger(category, text, details = '') {
  debug(category)(text, details);
  const trimmedText = trim(text, 100);
  const trimmedDetails = trim(details, 100 - trimmedText.length - 1);
  console.log(colors.bold(colors.green(category)), trimmedText, colors.dim(trimmedDetails));
}

/**
 * @param {string} text
 * @param {number} maxLength
 */
function trim(text, maxLength) {
  if (text.length <= maxLength)
    return text;
  return text.slice(0, maxLength - 3) + '...';
}

async function poem() {
  const loop = new Loop(provider);
  const { result } = await loop.run('Write a short poem about the sea.', { logger });
  console.log(result);
}

async function toolCall() {
  const loop = new Loop(provider);
  const tools = [
    {
      name: 'add',
      description: 'Adds two numbers together. Input and output are in JSON format.',
      inputSchema: {
        type: /** @type {const} */ ('object'),
        properties: {
          a: { type: 'number', description: 'The first number' },
          b: { type: 'number', description: 'The second number' },
        },
        required: ['a', 'b'],
      },
    }
  ];
  /**
   * @param {{ name: string, arguments: any }} params
   */
  const callTool = async (params) => {
    if (params.name === 'add') {
      const { a, b } = params.arguments;
      return { content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify({ result: a + b }) }] };
    }
    throw new Error(`Unknown tool: ${params.name}`);
  };

  const resultSchema = {
    type: /** @type {const} */ ('object'),
    properties: {
      result: { type: 'number', description: 'The sum of the two numbers' },
    },
    required: ['result'],
  }

  const { result } = await loop.run('Use add tool to add 2 and 3.', { tools, callTool, logger, resultSchema });
  console.log(result);  
}

async function imageToolCall() {
  const loop = new Loop(provider);
  const tools = [
    {
      name: 'capture_image',
      description: 'Captures an image.',
      inputSchema: {
        type: /** @type {const} */ ('object'),
        properties: {
        }
      },
    }
  ];
  /**
   * @param {{ name: string, arguments: any }} params
   */
  const callTool = async (params) => {
    if (params.name === 'capture_image') {
      const data = await fs.promises.readFile(path.resolve(__dirname, 'image.png'));
      return {
        content: [
          {
            type: /** @type {const} */ ('image'),
            mimeType: /** @type {const} */ ('image/png'),
            data: data.toString('base64')
          }
        ]
      };
    }
    throw new Error(`Unknown tool: ${params.name}`);
  };

  const { result } = await loop.run('Capture the image and tell me what you see on it', { tools, callTool, logger });
  console.log(result);  
}

// void poem();
// void toolCall();
void imageToolCall();
