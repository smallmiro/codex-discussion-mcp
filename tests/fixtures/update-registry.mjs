// Process-boundary registry simulation; never access public npm in tests.
globalThis.fetch = async (url, options) => {
  if (url !== 'https://registry.npmjs.org/@mirolab%2Fcodex-discussion-mcp/latest') throw new Error('Unexpected registry URL');
  if (options.redirect !== 'error') throw new Error('Registry redirects must be disabled');
  process.stderr.write('[test registry lookup]\n');
  if (process.env.TEST_REGISTRY_MODE === 'hang') {
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Registry aborted')), { once: true });
    });
  }
  if (process.env.TEST_REGISTRY_MODE === 'offline') throw new Error('Offline registry');
  return new Response(JSON.stringify({ version: '99.0.0' }));
};
