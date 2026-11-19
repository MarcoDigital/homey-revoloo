'use strict';

const Homey = require('homey');
const { registerLoginHandlers } = require('../../lib/pairing');

/**
 * False only for devices whose name clearly says they are a feeder or a
 * fountain. The listing format of other device types is not known yet, so
 * anything unclear is offered rather than risk hiding the user's litter box.
 */
function isLitterBox(device) {
  const name = [device.device_name, device.product_name, device.device_type, device.name]
    .filter(Boolean).join(' ').toLowerCase();
  if (/litter|toilet/.test(name)) return true;
  return !/feeder|fountain|water|dispenser|feed/.test(name);
}

class LitterBoxDriver extends Homey.Driver {

  async onInit() {
    this.statusChangedTrigger = this.homey.flow.getDeviceTriggerCard('litterbox_status_changed');
    this.cleaningFinishedTrigger = this.homey.flow.getDeviceTriggerCard('litterbox_cleaning_finished');
    this.catVisitTrigger = this.homey.flow.getDeviceTriggerCard('litterbox_cat_visit');
    this.eventTrigger = this.homey.flow.getDeviceTriggerCard('litterbox_event');
    this.litterLowTrigger = this.homey.flow.getDeviceTriggerCard('litterbox_litter_low');
    this.bagFullTrigger = this.homey.flow.getDeviceTriggerCard('litterbox_bag_full');
  }

  async onPair(session) {
    registerLoginHandlers(this.homey, session);

    // Feeders and fountains (Serve, Stream, Chow, Flow) are not supported yet
    // and are left out; the full listing is logged so support can be added.
    // On the Revoloo One, get_info reports device_name "Cat Automatic Litter Box".
    session.setHandler('list_devices', async () => {
      const devices = await this.homey.app.getApi().getDevices();
      this.log('Devices on account:', JSON.stringify(devices));
      this.homey.app.recordDiagnostic('devices', devices);
      return devices.filter((d) => {
        if (isLitterBox(d)) return true;
        this.log('Skipping device that is not a litter box:', d.device_name || d.product_name || d.name);
        return false;
      }).map((d) => {
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
