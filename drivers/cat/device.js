'use strict';

const Homey = require('homey');

const POLL_MS = 15 * 60 * 1000;
const LB_TO_KG = 0.45359237;
const OBSOLETE_CAPABILITIES = ['cat_toilet_time_today'];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A cat from the NOTTY account.
 *
 * NOTTY often cannot tell cats apart ("A cat 4.17kg left the toilet. Please
 * update pet profile."), so its per-pet statistics stay at 0. Instead, every
 * visit event from the litter box is matched to the cat whose weight is
 * closest (see App#onCatVisit). The cat's weight then follows the measured
 * weight, so matching keeps working as the cat gains or loses weight.
 */
class CatDevice extends Homey.Device {

  async onInit() {
    this.petId = this.getData().id;
    for (const cap of OBSOLETE_CAPABILITIES) {
      if (this.hasCapability(cap)) await this.removeCapability(cap).catch(this.error);
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

  /** Weight used to match visits: last measured weight, else the profile weight. */
  getReferenceWeight() {
    return toNumber(this.getCapabilityValue('measure_weight'));
  }

  getTolerance() {
    return toNumber(this.getSetting('weight_tolerance')) || 0.5;
  }

  async registerVisit(weight) {
    const today = this._todayKey();
    let visits = this.getStoreValue('visitsDay') === today ? (this.getStoreValue('visits') || 0) : 0;
    visits += 1;
    await this.setStoreValue('visitsDay', today);
    await this.setStoreValue('visits', visits);
    await this._set('cat_visits_today', visits);
    await this._set('measure_weight', weight);
    this.log(`Visit matched: ${weight} kg, ${visits} visit(s) today`);
    await this.driver.visitTrigger.trigger(this, { visits, weight }).catch(this.error);
  }

  _todayKey() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: this.homey.clock.getTimezone() });
  }

  async _poll() {
    try {
      // Reset the visit counter after midnight.
      if (this.getStoreValue('visitsDay') !== this._todayKey()) await this._set('cat_visits_today', 0);

      const pets = await this.homey.app.getPetsCached();
      const pet = pets.find((p) => String(p.pet_id !== undefined ? p.pet_id : p.id) === this.petId);
      if (!pet) {
        await this.setUnavailable(this.homey.__('device.cat_not_found')).catch(this.error);
      } else {
        if (!this.getAvailable()) await this.setAvailable();
        // Only seed the weight from the NOTTY profile until a visit was measured.
        if (this.getReferenceWeight() === null) {
          let weight = toNumber(pet.today_weight);
          if (weight !== null && weight > 0) {
            if (Number(pet.weight_unit) === 2) weight *= LB_TO_KG;
            await this._set('measure_weight', Math.round(weight * 100) / 100);
          }
        }
        if (this.getCapabilityValue('cat_visits_today') === null) await this._set('cat_visits_today', 0);
      }
    } catch (err) {
      this.error('Poll failed:', err.message);
      if (err.auth) {
        await this.setUnavailable(this.homey.__('device.login_expired')).catch(this.error);
      }
    }
    this._schedule(POLL_MS);
  }

  async _set(capability, value) {
    if (value === null || value === undefined || !this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch(this.error);
  }

}

module.exports = CatDevice;
