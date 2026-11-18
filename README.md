# Revoloo for Homey

Homey app for [Revoloo](https://revoloo.nl/) smart pet products. It currently
supports the **Revoloo One** litter box. The Revoloo Serve (feeder) and Revoloo
Stream (water fountain) are not supported yet.

Revoloo devices are controlled with the *NOTTY Smart Pet* app. This Homey app
talks to the same cloud (`api.nottycat.com`), so other litter boxes sold under
the NOTTY platform may work too, but that is untested.

> Community app, not affiliated with Revoloo or NOTTY. The cloud API is
> undocumented and may change at any time.

## Features

**Revoloo One litter box**
- Status (idle / cleaning / emptying / leveling), mode, litter and waste bag days remaining, cleanings and visits today, last cat weight, last event
- Buttons: clean now, level litter, empty litter
- Flow triggers: *a cat left the litter box* (with weight), *cleaning finished*, *new event*, *status changed*
- Flow condition: *status is…*
- Flow actions: *start cleaning*, *level*, *empty*, *set mode*

**Cat** (one per cat in your NOTTY account)
- Weight and toilet visits today
- Flow trigger: *cat used the litter box*

NOTTY often does not recognise which cat used the litter box, so each visit
is matched to the cat whose weight is closest (within a tolerance you can set
per cat, default 0.5 kg). Two cats of about the same weight cannot be told
apart.

The litter box is checked every 60 seconds (every 15 seconds while it is busy).

## Install on your own Homey (Pro or Self-Hosted Server)

Requirements: [Node.js](https://nodejs.org/) 18+ and the Homey CLI.

```bash
npm install -g homey
homey login
homey select
homey app install
```

When you add a device, enter the email address of your NOTTY Smart Pet
account; NOTTY emails you a one-time code to finish logging in.

Note: stopping `homey app run` uninstalls the app and removes its devices. Use
`homey app install` for everyday use.

## Status

Early version, running on one Revoloo One with two cats. Status code 3 (smart
cleaning) and the event list are confirmed on that device; the other status
codes come from community reverse-engineering. The app logs the raw API
responses once after start (visible with `homey app run`), which helps map
missing fields.

## Credits

API knowledge comes from these MIT-licensed Home Assistant integrations:
- [Repsay/notty](https://github.com/Repsay/notty)
- [onsmam/ha-Revoloo](https://github.com/onsmam/ha-Revoloo)

## License

MIT
