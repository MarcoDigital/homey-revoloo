---
name: New device
about: Help add support for a Revoloo device (Open, Serve, Chow, Stream, Flow)
title: "Support for Revoloo <device>"
labels: new device
---

**Device:** <!-- e.g. Revoloo Serve -->

**Does it show up when you add a "Revoloo One litter box" in Homey?** <!-- yes / no -->

### Logs

Support can only be added with data from a real device. To collect it:

1. Install Node.js, then run `npm install -g homey` and `homey login`.
2. Clone this repository and run `homey app run --remote` in its folder.
3. In the Homey app, start adding a **Revoloo One litter box** and log in. You
   don't have to finish adding a device.
4. Copy the lines with `Devices on account:` and, if you added a device,
   `get_info response:` from the terminal and paste them below.
5. Stop with Ctrl+C. Note: this uninstalls the development app and removes its
   devices; reinstall with `homey app install` afterwards.

Before pasting, replace personal data such as your email address with `***`.

```
paste logs here
```

**What does the NOTTY Smart Pet app show for this device?**
<!-- e.g. food level, portions, water level, filter days -->
