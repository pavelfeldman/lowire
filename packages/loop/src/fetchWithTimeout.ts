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

export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { signal?: AbortSignal, timeout?: number },
): Promise<Response> {
  if (!options.timeout)
    return fetch(url, options);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout);

  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (options.signal?.aborted)
      throw error;
    throw new Error(`Fetch timeout after ${options.timeout}ms`);
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abort);
  }
}
