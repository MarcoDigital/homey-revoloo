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
    const { token, userId } = await api.loginWithEmailCode(email, code);
    homey.app.saveSession({ email, token, userId });
    return true;
  });
}

module.exports = { registerLoginHandlers };
