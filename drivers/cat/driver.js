'use strict';

const Homey = require('homey');
const { registerLoginHandlers } = require('../../lib/pairing');

class CatDriver extends Homey.Driver {

  async onInit() {
    this.visitTrigger = this.homey.flow.getDeviceTriggerCard('cat_visited');
  }

  async onPair(session) {
    registerLoginHandlers(this.homey, session);

    session.setHandler('list_devices', async () => {
      const pets = await this.homey.app.getPetsCached();
      this.log('Pets on account:', pets.length);
      return pets.map((p) => {
        const id = String(p.pet_id !== undefined ? p.pet_id : p.id);
        const name = p.alias || p.name || p.pet_name;
        return {
          name: name || `Cat ${id}`,
          data: { id },
          store: { nottyName: name || null },
        };
      });
    });
  }

  async onRepair(session) {
    registerLoginHandlers(this.homey, session, { repair: true });
  }

}

module.exports = CatDriver;
