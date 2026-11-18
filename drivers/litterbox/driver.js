'use strict';

const Homey = require('homey');
const { registerLoginHandlers } = require('../../lib/pairing');

class LitterBoxDriver extends Homey.Driver {

  async onInit() {
    this.statusChangedTrigger = this.homey.flow.getDeviceTriggerCard('litterbox_status_changed');
    this.cleaningFinishedTrigger = this.homey.flow.getDeviceTriggerCard('litterbox_cleaning_finished');
    this.catVisitTrigger = this.homey.flow.getDeviceTriggerCard('litterbox_cat_visit');
    this.eventTrigger = this.homey.flow.getDeviceTriggerCard('litterbox_event');
  }

  async onPair(session) {
    registerLoginHandlers(this.homey, session);

    // The device type field of the NOTTY API is not mapped yet, so every
    // device on the account is offered; the user picks the litter box.
    session.setHandler('list_devices', async () => {
      const devices = await this.homey.app.getApi().getDevices();
      this.log('Devices on account:', JSON.stringify(devices));
      return devices.map((d) => {
        const id = String(d.user_device_id !== undefined ? d.user_device_id : d.id);
        return {
          name: d.alias || d.name || d.product_name || `Revoloo One ${id}`,
          data: { id },
        };
      });
    });
  }

  async onRepair(session) {
    registerLoginHandlers(this.homey, session, { repair: true });
  }

}

module.exports = LitterBoxDriver;
