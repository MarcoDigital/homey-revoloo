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

// Added after the first release; added to existing devices on start.
const NEW_CAPABILITIES = [
  'last_cat_weight', 'last_event', 'litter_cleaning', 'alarm_litter_low', 'alarm_bag_full', 'litter_visit_log',
];

// NOTTY answers with an error like "no permission" when a shared (non-owner)
// account tries to control the litter box: shared accounts can only view it.
const PERMISSION_ERROR = /permission|not allowed|forbidden|no auth|权限/i;

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

/** "Kiwi just spent 36s in the litter box." -> 36; "1m 20s" -> 80. */
function parseDurationS(text) {
  const t = text || '';
  const min = /(\d+)\s*(?:m|min|mins|minutes?)\b/i.exec(t);
  const sec = /(\d+)\s*(?:s|sec|secs|seconds?)\b/i.exec(t);
  if (!min && !sec) return null;
  return (min ? Number(min[1]) * 60 : 0) + (sec ? Number(sec[1]) : 0);
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
    this.homey.app.recordDiagnostic(`litterbox ${this.deviceId}`, info);

    // A shared NOTTY account can only view the litter box.
    if (info.is_owner === false) {
      await this.setWarning(this.homey.__('device.view_only')).catch(this.error);
    } else if (info.is_owner === true) {
      await this.unsetWarning().catch(this.error);
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
    if (status && status !== 'other') await this._set('litter_cleaning', BUSY.has(status));

    const litterDays = toNumber(pick(info, 'remaining_days'));
    const bagDays = toNumber(pick(info, 'garbage_bag_remaining_days'));
    await this._set('litter_remaining_days', litterDays);
    await this._set('bag_remaining_days', bagDays);
    await this._setAlarm('alarm_litter_low', litterDays, 'litter_low_days', this.driver.litterLowTrigger);
    await this._setAlarm('alarm_bag_full', bagDays, 'bag_low_days', this.driver.bagFullTrigger);
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
      const lastWeight = [...sorted].reverse().map((e) => parseWeightKg(e.event)).find((w) => w !== null);
      if (lastWeight !== undefined) await this._set('last_cat_weight', lastWeight);
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

      const duration = parseDurationS(text);
      let weight = parseWeightKg(text);
      const { visit, cat } = await this.homey.app.onLitterEvent(event, weight, duration).catch((err) => {
        this.error('onLitterEvent failed:', err.message);
        return { visit: false, cat: null };
      });
      if (visit) {
        // Events that name the cat carry no weight: use that cat's weight.
        if (weight === null && cat) weight = cat.getReferenceWeight();
        if (weight !== null) await this._set('last_cat_weight', weight);
        // Flipping the value adds one "A cat used the litter box" line to the activity log.
        await this._set('litter_visit_log', !this.getCapabilityValue('litter_visit_log'));
        await driver.catVisitTrigger.trigger(this, {
          weight: weight === null ? 0 : weight,
          cat: cat ? (cat.getNottyName() || cat.getName()) : '',
          duration: duration === null ? 0 : duration,
        }).catch(this.error);
      } else if (type === EVENT_COMPLETED && /clean/i.test(text)) {
        await driver.cleaningFinishedTrigger.trigger(this, { event: text }).catch(this.error);
      }
    }
  }

  /** Turn an alarm on when `days` drops to the threshold setting; trigger once on the way in. */
  async _setAlarm(capability, days, settingKey, trigger) {
    if (days === null || !this.hasCapability(capability)) return;
    const threshold = toNumber(this.getSetting(settingKey));
    const active = days <= (threshold === null ? 1 : threshold);
    const wasActive = this.getCapabilityValue(capability);
    await this._set(capability, active);
    if (active && wasActive === false) await trigger.trigger(this, { days }).catch(this.error);
  }

  async _set(capability, value) {
    if (value === null || value === undefined || !this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch(this.error);
  }

  async runOneKey(action) {
    await this._control(`one_key ${action}`, () => this.homey.app.getApi().oneKey(this.deviceId, action));
    this._schedule(5000);
  }

  async setLitterMode(mode) {
    await this._control('set_mode', () => this.homey.app.getApi().setMode(this.deviceId, mode));
    this._schedule(3000);
  }

  /** Run a command; explain NOTTY's refusal for shared (view-only) accounts. */
  async _control(name, command) {
    try {
      await command();
    } catch (err) {
      this.log(`${name} failed:`, err.code, err.message);
      if (PERMISSION_ERROR.test(err.message) || err.auth) {
        throw new Error(this.homey.__('device.view_only'));
      }
      throw err;
    }
  }

}

module.exports = LitterBoxDevice;
