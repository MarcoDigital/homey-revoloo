'use strict';

const Homey = require('homey');

const POLL_MS = 60 * 1000;
const POLL_BUSY_MS = 15 * 1000;

// 3 = smart cleaning, confirmed on a real device (status 3 while the app
// showed "Smart cleaning in progress"). 0/4/5/6 come from onsmam/ha-Revoloo.
// Other codes are reported as "other" and logged.
const STATUS_MAP = {
  0: 'idle', 3: 'cleaning', 4: 'cleaning', 5: 'emptying', 6: 'leveling',
};
const MODE_MAP = { 1: 'auto', 2: 'scheduled', 3: 'soft_stool' };
const BUSY = new Set(['cleaning', 'emptying', 'leveling']);

// event_type_id values seen in get_info.events
const EVENT_IN_PROGRESS = 10;
const EVENT_COMPLETED = 11;
const EVENT_CAT_LEFT = 12;

const NEW_CAPABILITIES = ['last_cat_weight', 'last_event'];

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return undefined;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseWeightKg(text) {
  const kg = /([\d.]+)\s*kg/i.exec(text || '');
  if (kg) return Number(kg[1]);
  const lb = /([\d.]+)\s*lb/i.exec(text || '');
  if (lb) return Math.round(Number(lb[1]) * 0.45359237 * 100) / 100;
  return null;
}

class LitterBoxDevice extends Homey.Device {

  async onInit() {
    this.deviceId = this.getData().id;

    for (const cap of NEW_CAPABILITIES) {
      if (!this.hasCapability(cap)) await this.addCapability(cap).catch(this.error);
    }

    this.registerCapabilityListener('button.clean', () => this.runOneKey('clean'));
    this.registerCapabilityListener('button.empty', () => this.runOneKey('empty'));
    this.registerCapabilityListener('button.level', () => this.runOneKey('level'));
    this.registerCapabilityListener('litter_mode', (mode) => this.setLitterMode(mode));

    this._schedule(1000);
  }

  onDeleted() {
    this.homey.clearTimeout(this._timer);
  }

  onUninit() {
    this.homey.clearTimeout(this._timer);
  }

  _schedule(ms) {
    this.homey.clearTimeout(this._timer);
    this._timer = this.homey.setTimeout(() => this._poll(), ms);
  }

  async _poll() {
    let nextMs = POLL_MS;
    try {
      const info = await this.homey.app.getApi().getLitterBoxInfo(this.deviceId);
      await this._apply(info || {});
      if (BUSY.has(this.getCapabilityValue('litter_status')) || this._lastEventInProgress) {
        nextMs = POLL_BUSY_MS;
      }
    } catch (err) {
      this.error('Poll failed:', err.message);
      if (err.auth) {
        await this.setUnavailable(this.homey.__('device.login_expired')).catch(this.error);
      }
    }
    this._schedule(nextMs);
  }

  async _apply(info) {
    if (!this._loggedRawInfo) {
      this.log('get_info response:', JSON.stringify(info));
      this._loggedRawInfo = true;
    }

    // status_id: 1 = online, 0 = offline
    if (toNumber(info.status_id) === 0) {
      await this.setUnavailable(this.homey.__('device.offline')).catch(this.error);
    } else if (!this.getAvailable()) {
      await this.setAvailable().catch(this.error);
    }

    const rawStatus = toNumber(pick(info, 'status', 'lb_status'));
    const status = rawStatus === null ? null : (STATUS_MAP[rawStatus] || 'other');
    if (rawStatus !== null && !STATUS_MAP[rawStatus] && rawStatus !== this._loggedUnknownStatus) {
      this.log('Unknown status code:', rawStatus);
      this._loggedUnknownStatus = rawStatus;
    }

    const rawMode = toNumber(pick(info, 'mode', 'lb_mode'));
    const mode = rawMode === null ? null : MODE_MAP[rawMode] || null;

    const previousStatus = this.getCapabilityValue('litter_status');
    await this._set('litter_status', status);
    await this._set('litter_mode', mode);
    await this._set('litter_remaining_days', toNumber(pick(info, 'remaining_days')));
    await this._set('bag_remaining_days', toNumber(pick(info, 'garbage_bag_remaining_days')));
    await this._set('clean_count_today', toNumber(pick(info, 'today_clean_count')));
    await this._set('toilet_count_today', toNumber(pick(info, 'toilet_count', 'today_toilet_count')));

    if (status && previousStatus && status !== previousStatus) {
      this.log(`Status ${previousStatus} -> ${status} (raw ${rawStatus})`);
      await this.driver.statusChangedTrigger.trigger(this, { status }).catch(this.error);
    }

    await this._processEvents(Array.isArray(info.events) ? info.events : []);
  }

  /**
   * get_info returns the most recent events (newest first). New events since
   * the last poll drive the Flow triggers. On the very first poll the current
   * events are only remembered, so old events do not fire.
   */
  async _processEvents(events) {
    const sorted = events
      .filter((e) => toNumber(e.event_id) !== null)
      .sort((a, b) => Number(a.event_id) - Number(b.event_id));
    if (!sorted.length) return;

    const newest = sorted[sorted.length - 1];
    this._lastEventInProgress = Number(newest.event_type_id) === EVENT_IN_PROGRESS;
    await this._set('last_event', String(newest.event || '').trim());

    const lastSeen = this.getStoreValue('lastEventId');
    if (lastSeen === null || lastSeen === undefined) {
      await this.setStoreValue('lastEventId', Number(newest.event_id));
      const lastVisit = [...sorted].reverse().find((e) => Number(e.event_type_id) === EVENT_CAT_LEFT);
      if (lastVisit) await this._set('last_cat_weight', parseWeightKg(lastVisit.event));
      return;
    }

    const fresh = sorted.filter((e) => Number(e.event_id) > Number(lastSeen));
    if (!fresh.length) return;
    await this.setStoreValue('lastEventId', Number(newest.event_id));

    const { driver } = this;
    for (const event of fresh) {
      const text = String(event.event || '').trim();
      const type = Number(event.event_type_id);
      this.log(`New event ${event.event_id} (type ${type}): ${text}`);

      await driver.eventTrigger.trigger(this, { event: text, type }).catch(this.error);

      if (type === EVENT_CAT_LEFT) {
        const weight = parseWeightKg(text);
        if (weight !== null) {
          await this._set('last_cat_weight', weight);
          await driver.catVisitTrigger.trigger(this, { weight }).catch(this.error);
          await this.homey.app.onCatVisit(weight).catch(this.error);
        }
      } else if (type === EVENT_COMPLETED && /clean/i.test(text)) {
        await driver.cleaningFinishedTrigger.trigger(this, { event: text }).catch(this.error);
      }
    }
  }

  async _set(capability, value) {
    if (value === null || value === undefined || !this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch(this.error);
  }

  async runOneKey(action) {
    await this.homey.app.getApi().oneKey(this.deviceId, action);
    this._schedule(5000);
  }

  async setLitterMode(mode) {
    await this.homey.app.getApi().setMode(this.deviceId, mode);
    this._schedule(3000);
  }

}

module.exports = LitterBoxDevice;
