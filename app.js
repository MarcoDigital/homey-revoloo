'use strict';

const Homey = require('homey');
const { NottyApi } = require('./lib/NottyApi');
const { redact } = require('./lib/redact');

const PETS_CACHE_MS = 30 * 1000;

// event_type_id values seen in get_info.events
const EVENT_IN_PROGRESS = 10;
const EVENT_COMPLETED = 11;
const EVENT_CAT_LEFT = 12;

class RevolooApp extends Homey.App {

  async onInit() {
    this._api = null;
    this._petsCache = { at: 0, promise: null };
    this._diagJson = {};
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

  /**
   * Keep the latest raw cloud response per key, with personal data hidden,
   * for the diagnostics page (settings/index.html). Only written when the
   * data changed.
   */
  recordDiagnostic(key, data) {
    try {
      const clean = redact(data);
      const json = JSON.stringify(clean);
      if (this._diagJson[key] === json) return;
      this._diagJson[key] = json;
      const diag = this.homey.settings.get('diagnostics') || {};
      diag[key] = { at: new Date().toISOString(), data: clean };
      this.homey.settings.set('diagnostics', diag);
    } catch (err) {
      this.error('recordDiagnostic failed:', err.message);
    }
  }

  /** Pets list shared by all cat devices, cached briefly to avoid duplicate calls. */
  async getPetsCached() {
    const now = Date.now();
    if (this._petsCache.promise && now - this._petsCache.at < PETS_CACHE_MS) {
      return this._petsCache.promise;
    }
    this._petsCache = { at: now, promise: this.getApi().getPets() };
    try {
      const pets = await this._petsCache.promise;
      this.recordDiagnostic('pets', pets);
      return pets;
    } catch (err) {
      this._petsCache = { at: 0, promise: null };
      throw err;
    }
  }

  /**
   * Handle a new litter box event and assign cat visits to a cat device.
   * Returns true when the event was a cat visit.
   *
   * 1. If NOTTY recognised the cat (the event carries its pet id or names it),
   *    that cat gets the visit.
   * 2. Otherwise a "cat left" event goes to the cat with the closest weight.
   */
  async onLitterEvent(event, weight) {
    const type = Number(event.event_type_id);
    const text = String(event.event || '').toLowerCase();
    const cats = this.homey.drivers.getDriver('cat').getDevices();

    if (type === EVENT_IN_PROGRESS || type === EVENT_COMPLETED) return false;

    const byNotty = cats.find((cat) => event.pet_id !== undefined && String(event.pet_id) === cat.petId)
      || cats.find((cat) => {
        const name = cat.getNottyName();
        return name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
      });
    if (byNotty) {
      await byNotty.registerVisit(weight);
      return true;
    }

    if (type !== EVENT_CAT_LEFT) return false;
    if (weight === null) return true;

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
    return true;
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
