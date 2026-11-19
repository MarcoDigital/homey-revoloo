'use strict';

const Homey = require('homey');

const POLL_MS = 2 * 60 * 1000;
const LB_TO_KG = 0.45359237;

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
 *   used once NOTTY recognises the cat (has_litter_box_data). The visit count
 *   shown is the highest of the two, so a visit is never counted twice.
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

  /** A visit from a litter box event. `weight` may be null. */
  async registerVisit(weight) {
    const visits = this._visitsToday() + 1;
    await this._setVisits(visits);
    if (weight !== null && weight !== undefined) await this._set('measure_weight', weight);
    this.log(`Visit: ${weight === null ? 'no weight' : `${weight} kg`}, ${visits} visit(s) today`);
    await this._logVisit(visits);
  }

  async _logVisit(visits) {
    // Flipping the value adds one "Used the litter box" line to the activity log.
    await this._set('cat_visit_log', !this.getCapabilityValue('cat_visit_log'));
    await this.driver.visitTrigger.trigger(this, {
      visits,
      weight: this.getCapabilityValue('measure_weight') || 0,
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

    // NOTTY's own visit count, if higher than what the events gave us.
    const nottyVisits = toNumber(pet.today_wc_count);
    const ours = this._visitsToday();
    if (nottyVisits !== null && nottyVisits > ours) {
      await this._setVisits(nottyVisits);
      // Only report visits that happened while Homey was watching.
      if (this.getStoreValue('statsSeen') === this._todayKey()) {
        for (let v = ours + 1; v <= nottyVisits; v++) await this._logVisit(v);
      }
    } else if (this.getCapabilityValue('cat_visits_today') === null) {
      await this._set('cat_visits_today', ours);
    }
    await this.setStoreValue('statsSeen', this._todayKey());
  }

  async _set(capability, value) {
    if (value === null || value === undefined || !this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch(this.error);
  }

}

module.exports = CatDevice;
