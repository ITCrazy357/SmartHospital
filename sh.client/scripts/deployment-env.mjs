export function validateDeploymentEnv(env) {
  const value = env.VITE_API_URL?.trim();
  if (!value) {
    throw new Error('Set VITE_API_URL to the HTTPS backend URL before deploying. Vite embeds this public value at build time.');
  }
  if (value !== env.VITE_API_URL) {
    throw new Error('VITE_API_URL must not contain leading or trailing whitespace.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VITE_API_URL must be an absolute HTTPS backend URL.');
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_API_URL must use HTTPS without credentials, a query string or a fragment.');
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
      url.hostname === '[::1]' || url.hostname === '0.0.0.0' || /^127\./.test(url.hostname)) {
    throw new Error('VITE_API_URL cannot point to a loopback address in a deployment.');
  }
  if (value !== url.href.replace(/\/$/, '')) {
    throw new Error('VITE_API_URL must be normalized and must not end with a slash.');
  }
}
