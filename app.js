'use strict';

const Homey = require('homey');
const { NottyApi } = require('./lib/NottyApi');

const PETS_CACHE_MS = 30 * 1000;

class RevolooApp extends Homey.App {

  async onInit() {
    this._api = null;
    this._petsCache = { at: 0, promise: null };
    this._registerFlowCards();
    this.log('Revoloo app started');
  }

  /** The shared, logged-in API client (one NOTTY account per Homey). */
  getApi() {
    if (!this._api) {
      const auth = this.homey.settings.get('auth') || {};
      this._api = new NottyApi({
        token: auth.token,
        userId: auth.userId,
        region: auth.region || 'NL',
        log: (...args) => this.log('[api]', ...args),
      });
    }
    return this._api;
  }

  /** Persist a fresh login. Called from the pairing / repair flow. */
  saveSession({ email, token, userId, region = 'NL' }) {
    this.homey.settings.set('auth', {
      email, token, userId, region,
    });
    this._api = null;
    this._petsCache = { at: 0, promise: null };
  }

  /** Pets list shared by all cat devices, cached briefly to avoid duplicate calls. */
  async getPetsCached() {
    const now = Date.now();
    if (this._petsCache.promise && now - this._petsCache.at < PETS_CACHE_MS) {
      return this._petsCache.promise;
    }
    this._petsCache = { at: now, promise: this.getApi().getPets() };
    try {
      return await this._petsCache.promise;
    } catch (err) {
      this._petsCache = { at: 0, promise: null };
      throw err;
    }
  }

  /** Assign a visit from the litter box to the cat with the closest weight. */
  async onCatVisit(weight) {
    const cats = this.homey.drivers.getDriver('cat').getDevices();
    let best = null;
    for (const cat of cats) {
      const ref = cat.getReferenceWeight();
      if (ref === null) continue;
      const diff = Math.abs(ref - weight);
      if (diff <= cat.getTolerance() && (!best || diff < best.diff)) best = { cat, diff };
    }
    if (best) {
      await best.cat.registerVisit(weight);
    } else if (cats.length) {
      this.log(`No cat within tolerance for visit of ${weight} kg`);
    }
  }

  _registerFlowCards() {
    const cards = this.homey.flow;

    for (const action of ['clean', 'empty', 'level']) {
      cards.getActionCard(`litterbox_${action}`)
        .registerRunListener(({ device }) => device.runOneKey(action));
    }

    cards.getActionCard('litterbox_set_mode')
      .registerRunListener(({ device, mode }) => device.setLitterMode(mode));

    cards.getConditionCard('litterbox_status_is')
      .registerRunListener(({ device, status }) => device.getCapabilityValue('litter_status') === status);
  }

}

module.exports = RevolooApp;
