import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDeploymentEnv } from './deployment-env.mjs';

test('deployment requires an explicit HTTPS backend URL', () => {
  for (const value of [undefined, '', ' ', '/api', 'http://api.example.com',
    'https://localhost', 'https://clinic.localhost', 'https://127.0.0.1', 'https://[::1]',
    'https://0.0.0.0', 'https://user:password@api.example.com',
    'https://api.example.com?token=value', 'https://api.example.com#fragment',
    'https://api.example.com/', ' https://api.example.com ']) {
    assert.throws(() => validateDeploymentEnv({ VITE_API_URL: value }));
  }
});

test('deployment accepts a backend origin or an explicit API base path', () => {
  for (const value of ['https://api.example.com', 'https://api.example.com/api/v1']) {
    assert.doesNotThrow(() => validateDeploymentEnv({ VITE_API_URL: value }));
  }
});
