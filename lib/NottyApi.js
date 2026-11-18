'use strict';

/**
 * Minimal client for the NOTTY cloud API (api.nottycat.com).
 *
 * This API is unofficial and undocumented. Endpoints, headers and field names
 * are based on the community reverse-engineering work in:
 *   - https://github.com/Repsay/notty      (MIT)
 *   - https://github.com/onsmam/ha-Revoloo (MIT)
 */

const BASE_URL = 'https://api.nottycat.com';
const APP_USER_AGENT = '4.1.0;android;6.0.1;default;A001';
const APP_VERSION_NUMBER = '1.1.30+76';
const LOGIN_CODE_TYPE_ID = 1;
const LOGIN_DEVICE_ID = '1';
const DEFAULT_CLIENT_ID = '0';
const TIMEOUT_MS = 20000;

const ONE_KEY = { clean: 1, empty: 2, level: 3 };
const MODES = { auto: 1, scheduled: 2, soft_stool: 3 };
const SUCCESS_CODES = new Set(['0', '200']);
const AUTH_ERROR_CODES = new Set(['401', '403', '1001', '1002']);

class NottyError extends Error {
  constructor(message, { code, status, auth = false } = {}) {
    super(message);
    this.name = 'NottyError';
    this.code = code;
    this.status = status;
    this.auth = auth;
  }
}

/** Depth-first search for the first key in `keys` with a non-empty value. */
function findKey(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  for (const value of Object.values(obj)) {
    const found = findKey(value, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function asList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['list', 'devices', 'rows', 'items', 'pets']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

class NottyApi {
  /**
   * @param {object} opts
   * @param {string} [opts.token]
   * @param {string|number} [opts.userId]
   * @param {string} [opts.region] e.g. "NL"
   * @param {(...args: any[]) => void} [opts.log]
   */
  constructor({ token, userId, region = 'NL', log } = {}) {
    this.token = token ? String(token).replace(/^Bearer\s+/i, '') : null;
    this.userId = userId ? String(userId) : null;
    this.region = region;
    this.log = log || (() => {});
  }

  get isLoggedIn() {
    return Boolean(this.token);
  }

  _headers() {
    const headers = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en',
      'Content-Type': 'application/json',
      'User-Agent': APP_USER_AGENT,
      // Misspelling is intentional: the official app sends this header.
      'User-Aagent': APP_USER_AGENT,
      HZUID: this.userId || '2',
      'XJiang-Language': 'en',
    };
    if (this.region) headers.xjiang_region_id = this.region;
    if (this.token) {
      headers.Authorization = this.token;
      headers.access_token = this.token;
    }
    return headers;
  }

  async _request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: this._headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new NottyError(`Network error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (err) {
      payload = { raw: text };
    }

    if (res.status === 401 || res.status === 403) {
      throw new NottyError('Not authorized, please log in again', { status: res.status, auth: true });
    }
    if (res.status >= 400) {
      throw new NottyError(`HTTP ${res.status}`, { status: res.status });
    }
    return this._unwrap(payload);
  }

  _unwrap(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const code = payload.code !== undefined ? payload.code : payload.error_code;
    if (code !== undefined && code !== null && !SUCCESS_CODES.has(String(code))) {
      const message = payload.message || payload.msg || JSON.stringify(payload);
      throw new NottyError(message, { code, auth: AUTH_ERROR_CODES.has(String(code)) });
    }
    if (payload.data !== undefined) return payload.data;
    if (payload.result !== undefined) return payload.result;
    return payload;
  }

  // ---------------------------------------------------------------- auth

  /** Ask NOTTY to email a one-time login code. */
  async requestEmailCode(email) {
    return this._request('POST', '/account/get_email_code', {
      email,
      code_type_id: LOGIN_CODE_TYPE_ID,
      client_id: DEFAULT_CLIENT_ID,
    });
  }

  /**
   * Exchange the emailed code for an access token. Returns { token, userId }.
   *
   * The official app always sends device_id "1". Logging in elsewhere with
   * that same id may end the phone app's session, so callers can pass their
   * own id (experimental, see App#getLoginDeviceId).
   */
  async loginWithEmailCode(email, code, { deviceId = LOGIN_DEVICE_ID } = {}) {
    this.token = null;
    this.userId = null;
    const result = await this._request('POST', '/account/login_by_email', {
      email,
      code: String(code).trim(),
      device_id: String(deviceId),
      version_number: APP_VERSION_NUMBER,
    });
    const token = findKey(result, ['access_token', 'accessToken', 'token']);
    const userId = findKey(result, ['user_id', 'userId', 'uid']);
    if (!token) throw new NottyError('Login succeeded but no token was returned');
    this.token = String(token).replace(/^Bearer\s+/i, '');
    this.userId = userId !== undefined ? String(userId) : null;
    return { token: this.token, userId: this.userId };
  }

  // ---------------------------------------------------------------- data

  async getPets() {
    return asList(await this._request('GET', '/pet/list'));
  }

  /**
   * List all devices on the account. The app queries per pet id, plus a
   * literal "2" fallback; results are merged on user_device_id.
   */
  async getDevices() {
    const byId = new Map();
    const add = (list) => {
      for (const device of asList(list)) {
        const id = device.user_device_id !== undefined ? device.user_device_id : device.id;
        if (id !== undefined && !byId.has(String(id))) byId.set(String(id), device);
      }
    };

    let petIds = [];
    try {
      petIds = (await this.getPets())
        .map((p) => (p.pet_id !== undefined ? p.pet_id : p.id))
        .filter((id) => id !== undefined);
    } catch (err) {
      if (err.auth) throw err;
      this.log('getPets failed while listing devices:', err.message);
    }

    for (const path of [...petIds.map((id) => `/device/get_user_devices/${id}`), '/device/get_user_devices/2']) {
      try {
        add(await this._request('GET', path));
      } catch (err) {
        if (err.auth) throw err;
        this.log(`${path} failed:`, err.message);
      }
    }
    return [...byId.values()];
  }

  async getLitterBoxInfo(userDeviceId) {
    return this._request('GET', `/device/litter_box/get_info/${userDeviceId}`);
  }

  // ---------------------------------------------------------------- commands

  async oneKey(userDeviceId, action) {
    const oneKey = ONE_KEY[action];
    if (!oneKey) throw new Error(`Unknown action: ${action}`);
    return this._request('POST', '/device/litter_box/one_key', {
      user_device_id: String(userDeviceId),
      one_key: oneKey,
    });
  }

  async setMode(userDeviceId, mode) {
    const value = MODES[mode];
    if (!value) throw new Error(`Unknown mode: ${mode}`);
    return this._request('POST', '/device/litter_box/set_mode', {
      user_device_id: Number(userDeviceId),
      mode: value,
    });
  }
}

module.exports = {
  NottyApi, NottyError, ONE_KEY, MODES,
};
