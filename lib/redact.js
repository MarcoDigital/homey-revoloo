'use strict';

/**
 * Deep copy of `value` with personal or identifying fields hidden, so the
 * diagnostics can be pasted into a public GitHub issue.
 */

const HIDDEN_KEYS = new Set([
  'email', 'token', 'access_token', 'accessToken', 'refresh_token', 'refreshToken',
  'aliyun_device_name', 'device_number', 'health_url', 'mobile', 'phone',
  'mac', 'ip', 'ssid', 'wifi_name', 'serial', 'sn',
]);
const EMAIL = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/g;

function redact(value, depth = 0) {
  if (depth > 8) return '…';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = HIDDEN_KEYS.has(key) && v !== '' && v !== null ? '***' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.replace(EMAIL, '***@***');
  return value;
}

module.exports = { redact };
