# Revoloo for Homey

Homey app for [Revoloo](https://revoloo.nl/) smart pet products.

Revoloo devices are set up and managed with the *NOTTY Smart Pet* app. This
Homey app reads from and sends commands to the same cloud
(`api.nottycat.com`).

## Supported devices

Revoloo has two product lines, each with a litter box, a feeder and a water
fountain:

| Product | Line | Type | Status |
|---|---|---|---|
| Revoloo One | One | Self-cleaning litter box | ✅ Supported, tested |
| Revoloo Open | Open | Open litter box | ❓ May work, untested |
| Revoloo Serve | One | Feeder | ❌ Not yet |
| Revoloo Chow | Open | Feeder | ❌ Not yet |
| Revoloo Stream | One | Water fountain | ❌ Not yet |
| Revoloo Flow | Open | Water fountain | ❌ Not yet |

Feeders and fountains are left out when you add a litter box. Other litter
boxes on the NOTTY platform may work too, but that is untested.

**Do you own one of the other devices?** Support can only be added with data
from a real device. Please
[open a "New device" issue](https://github.com/MarcoDigital/homey-revoloo/issues/new?template=new-device.md)
with the logs described there.

> Community app, not affiliated with Revoloo or NOTTY. The cloud API is
> undocumented and may change at any time.

## Before you start: set up NOTTY first

Homey only shows what is already known in the NOTTY cloud. It does not set up
the litter box or create cat profiles. So, in this order:

1. Install the **NOTTY Smart Pet** app on your phone and create an account.
2. Add your Revoloo One in the NOTTY app and connect it to your Wi-Fi.
3. Add your cats in the NOTTY app and set their weight. You keep managing the
   cat profiles there.
4. Then install this app on Homey and add your devices (see below).

### Recommended: a second NOTTY account for Homey

NOTTY allows only one active login per account. If Homey and your phone use
the same account, logging in on one logs the other out. To use both at the
same time, give Homey its own account and share the litter box with it:

1. In the NOTTY app, log out (Home → Settings → Log out) and register a new
   account with a second email address. A separate alias address works; an
   address with `+` (like `name+homey@…`) has not been tested.
2. Log out again and log in with your main account.
3. Open the litter box in the NOTTY app and use **Share device** to invite the
   second account.
4. In Homey, log in with the second account.

Your phone stays logged in with your main account, and Homey uses the second
one. The cats of the main account are also available to the second account
after sharing the litter box (tested). (Sending a different device id at login does not avoid the limit; this
was tested.)

## Features

### Revoloo One litter box

| Shows | Notes |
|---|---|
| Status | Idle, cleaning, emptying, leveling or busy |
| Mode | Auto, scheduled or soft stool; can be changed by the owner account only (see below) |
| Litter remaining | Days until the litter needs refilling |
| Waste bag remaining | Days until the waste bag needs changing |
| Cleanings today, visits today | As counted by the NOTTY cloud |
| Last cat weight | Weight measured at the last visit |
| Last event | E.g. "Automatic cleaning completed" |
| Litter almost empty | Alarm when the litter days left reach a threshold you set (default 2 days) |
| Waste bag almost full | Alarm when the waste bag days left reach a threshold you set (default 1 day) |

Buttons: **clean now**, **level litter**, **empty litter**.

The device's activity history shows when cleaning started and finished,
when a cat used the litter box, and when the litter or waste bag alarm turned
on or off.

A shared (non-owner) NOTTY account can use the buttons, but NOTTY does not
allow it to change the mode. Change the mode in the NOTTY app with the owner
account; Homey then shows the new mode.

### Cat

One device per cat in your NOTTY account, showing its **weight** and
**toilet visits today**.

Visits are assigned like this:

1. **NOTTY recognises the cat** ("Kiwi just spent 36s in the litter box.").
   The visit goes to that cat, with its weight from NOTTY and the time spent
   in the litter box. Keep the cats' weights up to date in the NOTTY app, so
   NOTTY can tell them apart.
2. **NOTTY does not recognise the cat** ("A cat 4.17kg left the toilet.
   Please update pet profile."). The visit goes to the cat whose weight is
   closest, within a tolerance you can set per cat (default 0.5 kg).

If an event is missed, NOTTY's daily statistics for the cat still add the
visit a few minutes later, without counting it twice. "Visits today" follows
Homey's clock; NOTTY's own day starts at midnight China time. Each visit also
appears in the cat's activity history.

### Flow cards

| Type | Card | Tokens |
|---|---|---|
| Trigger | A cat left the litter box | weight (kg), cat, time in the litter box (s) |
| Trigger | Cleaning finished | event |
| Trigger | New event | event, type |
| Trigger | Status changed | status |
| Trigger | Litter is almost empty | days left |
| Trigger | Waste bag is almost full | days left |
| Trigger (cat) | Cat used the litter box | visits, weight, time in the litter box (s) |
| Condition | Status is / is not … | |
| Action | Start cleaning | |
| Action | Level the litter | |
| Action | Empty the litter | |
| Action | Set mode | |

The litter box is checked every 60 seconds, and every 15 seconds while it is
busy, so triggers can be up to a minute late.

## Install

Requirements: a Homey Pro or Homey Self-Hosted Server (version 12.2 or newer),
and on your computer [Node.js](https://nodejs.org/) 18+ and Git.

```bash
git clone https://github.com/MarcoDigital/homey-revoloo.git
cd homey-revoloo
npm install -g homey
homey login
homey select
homey app install
```

On Windows PowerShell you may need `npm.cmd` and `homey.cmd` instead of `npm`
and `homey` if running scripts is disabled.

## Add your devices

1. In the Homey app, add a device and choose **Revoloo**.
2. Choose **Revoloo One litter box**.
3. Enter the email address of your NOTTY Smart Pet account. NOTTY emails you a
   one-time code; enter it to log in.
4. Select your litter box.
5. Add your cats the same way with **Cat**. You don't need to log in again.

## Troubleshooting

| Problem | Solution |
|---|---|
| Device shows "login expired" | You probably logged in to the NOTTY app with the same account, which ends the Homey login. Open the device, choose **Repair** and log in again. To avoid this, use a second NOTTY account for Homey (see above). |
| Cat device unavailable | The cat was removed from the NOTTY app. Remove the cat in Homey as well. |
| Litter box unavailable / offline | The NOTTY cloud reports the box as offline. Check its power and Wi-Fi in the NOTTY app. |
| Visits go to the wrong cat, or to none | Check the cats' weights and the **weight tolerance** setting of each cat. |
| Status shows "Busy" | The box reported a status code the app does not know yet. Please open an issue. |
| Changing the mode says the account may not do that | You are logged in with a shared account. Change the mode in the NOTTY app with the owner account. |

### Diagnostics

The app's settings page (**More → Apps → Revoloo → Configure app**) shows the
latest data the NOTTY cloud sent, with email addresses, tokens and serial
numbers hidden. Use **Copy** and paste it in your issue when you report a
problem or ask for support for a new device.

## Development

```
app.js                  App: NOTTY session, pets cache, diagnostics, Flow cards, cat visits
app.json                Manifest: capabilities, drivers, Flow cards
lib/NottyApi.js         Client for the NOTTY cloud API
lib/pairing.js          Email-code login, shared by pairing and repair
lib/redact.js           Hides personal data in the diagnostics
settings/index.html     Diagnostics page
drivers/litterbox/      Revoloo One driver, device, pairing (pair/) and repair (repair/) views
drivers/cat/            Cat driver, device, pairing (pair/) and repair (repair/) views
locales/                English and Dutch texts
assets/                 App icon and images
assets/source/          SVG sources of the images and render.js
README.txt              App Store description (Homey shows this text, not README.md)
.homeychangelog.json    Changelog shown in the Homey App Store
.github/ISSUE_TEMPLATE/ Templates for bug reports and new device requests
```

Run with live logs:

```bash
homey app run --remote
```

Note: stopping `homey app run` uninstalls the app and removes its devices.
Use `homey app install` for everyday use. After start the app logs the raw API
responses once, which helps map new fields and status codes.

The images are original illustrations. To change them, edit the SVG files in
`assets/source/` and render them again:

```bash
npm install --no-save @resvg/resvg-js
node assets/source/render.js
```

### What is known about the API

- Login: `POST /account/get_email_code`, then `POST /account/login_by_email`.
- Litter box status: `GET /device/litter_box/get_info/{user_device_id}`.
  Status code 3 (smart cleaning) is confirmed on a real Revoloo One; 0, 4, 5
  and 6 come from community work. The response includes the latest events
  (`event_type_id` 10 = in progress, 11 = completed, 12 = cat left).
- Commands: `POST /device/litter_box/one_key` with 1 = clean, 2 = empty,
  3 = level; `POST /device/litter_box/set_mode`.
- Cats: `GET /pet/list`.
- Event times in the API are 7 hours ahead of Dutch time (probably China
  time); the app does not use them.

## Credits

API knowledge comes from these MIT-licensed Home Assistant integrations:
- [Repsay/notty](https://github.com/Repsay/notty)
- [onsmam/ha-Revoloo](https://github.com/onsmam/ha-Revoloo)

## License

[MIT](LICENSE)
