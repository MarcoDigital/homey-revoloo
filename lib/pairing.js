'use strict';

const { NottyApi } = require('./NottyApi');

/**
 * Shared pairing/repair handlers for the two-step NOTTY email-code login.
 * Views: pair/login_email.html -> pair/login_code.html.
 * If a session already exists, `has_session` lets the first view skip ahead.
 */
function registerLoginHandlers(homey, session, { repair = false } = {}) {
  let email = null;
  const api = new NottyApi({ log: (...args) => homey.app.log('[pair]', ...args) });

  // During repair the user always logs in again.
  session.setHandler('has_session', async () => !repair && homey.app.getApi().isLoggedIn);

  session.setHandler('send_code', async (data) => {
    email = String((data && data.email) || '').trim();
    if (!email) throw new Error(homey.__('pair.email_required'));
    await api.requestEmailCode(email);
    return true;
  });

  session.setHandler('login', async (data) => {
    const code = String((data && data.code) || '').trim();
    if (!email) throw new Error(homey.__('pair.email_required'));
    if (!code) throw new Error(homey.__('pair.code_required'));
    const deviceId = homey.app.getLoginDeviceId();
    let result;
    try {
      result = await api.loginWithEmailCode(email, code, { deviceId });
    } catch (err) {
      // If the server does not accept our own device id, fall back to the
      // official app's id next time. The code may be used up, so the user
      // has to request a new one.
      if (deviceId !== '1' && !err.auth) {
        homey.app.log(`Login with device id ${deviceId} failed (${err.message}); falling back to "1"`);
        homey.app.disableOwnLoginDeviceId();
        throw new Error(homey.__('pair.retry_new_code'));
      }
      throw err;
    }
    homey.app.log(`Logged in with device id ${deviceId}`);
    homey.app.saveSession({ email, token: result.token, userId: result.userId });
    return true;
  });
}

module.exports = { registerLoginHandlers };
