'use strict';

const Homey = require('homey');

const POLL_MS = 2 * 60 * 1000;
const LB_TO_KG = 0.45359237;
// How long a visit seen only in NOTTY's statistics waits for its event.
const LATE_EVENT_MS = 5 * 60 * 1000;
// Events remembered so NOTTY's statistics don't count them again.
const MAX_CREDIT = 5;

// Added after the first release; added to existing devices on start.
const NEW_CAPABILITIES = ['cat_visit_log'];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function petWeightKg(pet) {
  let weight = toNumber(pet.today_weight);
  if (weight === null || weight <= 0) return null;
  if (Number(pet.weight_unit) === 2) weight *= LB_TO_KG;
  return Math.round(weight * 100) / 100;
}

/**
 * A cat from the NOTTY account.
 *
 * Visits come from two sources:
 * - Litter box events (App#onLitterEvent). If NOTTY recognised the cat, the
 *   event goes to that cat; otherwise to the cat with the closest weight.
 * - NOTTY's own daily statistics in /pet/list (today_wc_count, today_weight),
 *   for visits the events missed (see _applyStats).
 * The visit count shown is for today in Homey's time zone.
 */
class CatDevice extends Homey.Device {

  async onInit() {
    this.petId = this.getData().id;
    for (const cap of NEW_CAPABILITIES) {
      if (!this.hasCapability(cap)) await this.addCapability(cap).catch(this.error);
    }
    this._schedule(2000);
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

  /** The cat's name in NOTTY, used to recognise it in litter box events. */
  getNottyName() {
    return this.getStoreValue('nottyName') || null;
  }

  /** Weight used to match visits: last measured weight, else the profile weight. */
  getReferenceWeight() {
    return toNumber(this.getCapabilityValue('measure_weight'));
  }

  getTolerance() {
    return toNumber(this.getSetting('weight_tolerance')) || 0.5;
  }

  _todayKey() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: this.homey.clock.getTimezone() });
  }

  _visitsToday() {
    return this.getStoreValue('visitsDay') === this._todayKey() ? (this.getStoreValue('visits') || 0) : 0;
  }

  async _setVisits(visits) {
    await this.setStoreValue('visitsDay', this._todayKey());
    await this.setStoreValue('visits', visits);
    await this._set('cat_visits_today', visits);
  }

  /** A visit from a litter box event. `weight` and `duration` (s) may be null. */
  async registerVisit(weight, duration = null) {
    if (weight !== null && weight !== undefined) await this._set('measure_weight', weight);

    // NOTTY's statistics already reported this visit (see _applyStats): it is
    // counted, so only the details are new.
    const pending = this.getStoreValue('pendingMissed');
    if (pending && pending.n > 0) {
      await this.setStoreValue('pendingMissed', pending.n > 1 ? { ...pending, n: pending.n - 1 } : null);
      this.log('Visit event for a visit already seen in the NOTTY statistics');
    } else {
      // Remember it, so the statistics don't count it a second time.
      await this.setStoreValue('eventCredit', Math.min(MAX_CREDIT, (this.getStoreValue('eventCredit') || 0) + 1));
    }

    const visits = this._visitsToday() + 1;
    await this._setVisits(visits);
    this.log(`Visit: ${weight === null ? 'no weight' : `${weight} kg`}, ${duration === null ? '?' : duration} s, ${visits} visit(s) today`);
    await this._logVisit(visits, duration);
  }

  async _logVisit(visits, duration = null) {
    // Flipping the value adds one "Used the litter box" line to the activity log.
    await this._set('cat_visit_log', !this.getCapabilityValue('cat_visit_log'));
    await this.driver.visitTrigger.trigger(this, {
      visits,
      weight: this.getCapabilityValue('measure_weight') || 0,
      duration: duration === null ? 0 : duration,
    }).catch(this.error);
  }

  async _poll() {
    try {
      // Reset the visit counter after midnight.
      if (this.getStoreValue('visitsDay') !== this._todayKey()) await this._setVisits(0);

      const pets = await this.homey.app.getPetsCached();
      const pet = pets.find((p) => String(p.pet_id !== undefined ? p.pet_id : p.id) === this.petId);
      if (!pet) {
        await this.setUnavailable(this.homey.__('device.cat_not_found')).catch(this.error);
      } else {
        if (!this.getAvailable()) await this.setAvailable();
        await this._apply(pet);
      }
    } catch (err) {
      this.error('Poll failed:', err.message);
      if (err.auth) {
        await this.setUnavailable(this.homey.__('device.login_expired')).catch(this.error);
      }
    }
    this._schedule(POLL_MS);
  }

  async _apply(pet) {
    const name = pet.alias || pet.name || pet.pet_name;
    if (name && name !== this.getNottyName()) await this.setStoreValue('nottyName', name);

    const nottyKnowsCat = pet.has_litter_box_data === true || toNumber(pet.today_wc_count) > 0;
    const weight = petWeightKg(pet);

    // NOTTY's measured weight once it recognises the cat; before that, only
    // seed from the profile weight until a visit has been measured.
    if (weight !== null && (nottyKnowsCat || this.getReferenceWeight() === null)) {
      await this._set('measure_weight', weight);
    }

    await this._applyStats(toNumber(pet.today_wc_count));
    if (this.getCapabilityValue('cat_visits_today') === null) {
      await this._set('cat_visits_today', this._visitsToday());
    }
  }

  /**
   * Catch visits the litter box events missed, from NOTTY's daily visit
   * count. NOTTY's "today" starts at midnight China time (17:00 or 18:00 in
   * Europe), so the count is only used for its increases, never as the
   * day's total. Increases already reported by an event are skipped; the
   * rest wait a few minutes for a late event before they are counted.
   */
  async _applyStats(count, now = Date.now()) {
    if (count === null) return;
    const last = this.getStoreValue('nottyCount');
    await this.setStoreValue('nottyCount', count);
    if (last !== null && last !== undefined) {
      // A lower count means NOTTY started a new day.
      const delta = count >= last ? count - last : count;
      if (delta > 0) {
        const credit = this.getStoreValue('eventCredit') || 0;
        await this.setStoreValue('eventCredit', Math.max(0, credit - delta));
        const missed = Math.max(0, delta - credit);
        if (missed > 0) {
          const pending = this.getStoreValue('pendingMissed');
          await this.setStoreValue('pendingMissed', { n: ((pending && pending.n) || 0) + missed, at: now });
        }
      }
    }

    const pending = this.getStoreValue('pendingMissed');
    if (pending && pending.n > 0 && now - pending.at >= LATE_EVENT_MS) {
      await this.setStoreValue('pendingMissed', null);
      this.log(`${pending.n} visit(s) from the NOTTY statistics without an event`);
      for (let i = 0; i < pending.n; i++) {
        const visits = this._visitsToday() + 1;
        await this._setVisits(visits);
        await this._logVisit(visits);
      }
    }
  }

  async _set(capability, value) {
    if (value === null || value === undefined || !this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch(this.error);
  }

}

module.exports = CatDevice;
