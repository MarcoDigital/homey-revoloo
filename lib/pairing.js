'use strict';

const { NottyApi } = require('./NottyApi');

/**
 * Shared pairing/repair handlers for the two-step NOTTY email-code login.
 * Views: login_email.html -> login_code.html (in pair/ and repair/).
 *
 * `get_session` tells the first view whether a working login exists, so it
 * can offer "continue as <email>" or a different account. The session is
 * checked against the cloud, because logging in elsewhere (e.g. in the
 * NOTTY app) ends it without Homey knowing.
 */
function registerLoginHandlers(homey, session, { repair = false } = {}) {
  let email = null;
  const api = new NottyApi({ log: (...args) => homey.app.log('[pair]', ...args) });

  session.setHandler('get_session', async () => {
    const current = homey.app.getApi();
    const savedEmail = (homey.settings.get('auth') || {}).email || null;
    // During repair the user always logs in again.
    if (repair || !current.isLoggedIn) return { loggedIn: false, email: savedEmail };
    try {
      await current.getPets();
      return { loggedIn: true, email: savedEmail };
    } catch (err) {
      if (err.auth) return { loggedIn: false, expired: true, email: savedEmail };
      // Network trouble: assume the login still works.
      return { loggedIn: true, email: savedEmail };
    }
  });

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
