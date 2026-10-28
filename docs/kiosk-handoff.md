# Tee24 Bay Kiosk — handoff (read this first)

Written 26 Oct 2026 from a Cursor session on a Mac. The next session is expected on a Windows PC that can run GSPro and the Golfin Launcher. Read this file before asking the user to re-explain the kiosk.

Repo: [robtee24/tee24-booking](https://github.com/robtee24/tee24-booking). The kiosk is `bay-app/`. It is not in the tee24-golf marketing site.

## What the kiosk is

Electron app (`tee24-bay-kiosk`) that replaces the Golfin Launcher home screen on each bay PC.

- Starts at Windows login.
- **Play** starts the launch-monitor program and `GSPro.exe` together. The home screen hides while that GSPro process is running and comes back when it exits. **Ctrl+Shift+T** brings the home screen back over GSPro.
- Floating Help / Schedule / Export strip on the right edge while the launched GSPro process is running.
- Reservation behavior comes from `https://reservations.tee24.golf` (`/api/bay-app/status`). It stays inert unless the location has bay-app mode on in admin. Check-in is the member’s phone number. A warning modal fires 10 minutes before the next booking. Countdowns use server time.
- One computer per bay. Registering a second computer onto a bay returns `BAY_TAKEN` (409) unless the admin confirms a takeover (`force`), which deletes the previous device. Do not point a test PC at a bay that already has a live kiosk.
- Admin settings (gear, top-right) require an admin phone and a texted code. Session lasts 30 minutes.
- Help content is the shared troubleshooting tree from the server (`/api/bay-app/help`), so copy changes do not need a reinstall.
- Export finds a GSPro “Export CSV” file on disk and sends it to the Tee24 app and/or email.

Default paths in `bay-app/src/main/store.ts`:

- GSPro: `C:\GSProV1\Core\GSP\GSPro.exe`
- IDRA II (GolfIn): `C:\Program Files\Sim Sports Corporation\IDRA\<version>\IDRAMonitor.exe` — resolved at runtime by `findIdraMonitor()`; 8.2.6 on the test PC
- SkyTrak: `C:\Program Files\SkyTrak\SkyTrak.exe`
- ProTee VX: `C:\Program Files\ProTee United\ProTee VX\ProTeeVX.exe`

## How GolfIn starts GSPro (verified 27 Oct 2026 on the test PC)

IDRA is **not** a Uneekor product. The launch monitor is the GolfIn **IDRA II**; the software publisher is Sim Sports Corporation. Earlier builds (≤ 1.1.0) shipped a Uneekor View path for IDRA that never existed on a bay PC, so Play started a bare GSPro with no launch monitor. `migrateSettings()` repairs that on first run of a newer build.

Process tree when the GolfIn Launcher's IDRA tile is clicked (GolfIn Launcher 10.3.1, IDRA 8.2.6, GSPro 3.1.6.20):

```
GolfInLauncher.exe
└─ IDRAMonitor.exe            (no arguments)
   ├─ GSPro.exe               (no arguments)
   └─ IDRA.exe                (connector; talks to GSPro over Open Connect)
```

- Starting `IDRAMonitor.exe` directly, with the GolfIn Launcher closed, produces exactly the same result. The kiosk does not need GolfIn running.
- The orange "IDRA" badge at the top of GSPro is GSPro's own connected-launch-monitor indicator. There is no separate overlay window from IDRA.
- `IDRAMonitor.exe`'s lifetime is **not** a reliable session signal. On the test laptop (no NVIDIA GPU) IDRA's camera process logs `CUDA is not available on this system`, `IDRA.exe` exits with code 400 two seconds after starting, and the monitor exits with it while GSPro keeps running. So `launcher.ts` polls `tasklist` for a `GSPro.exe` process every 2 s and treats *that* as the session, however GSPro was started (Play, GolfIn Launcher, shortcut). Play while GSPro is already running does not start a second copy.
- GSPro runs as a borderless popup window, not exclusive fullscreen.
- IDRA's own logs: `C:\ProgramData\Sim Sports Corporation\IDRA\logs\{idra,idra_monitor,cameras}`. GolfIn Launcher's: `C:\ProgramData\Sim Sports Corporation\GolfIn Launcher\Logs`.

API base: `https://reservations.tee24.golf`.

## Published build

Windows installer only (NSIS, x64, **per-user** since 1.2.0, unsigned). GitHub Actions workflow: `.github/workflows/kiosk-release.yml`. Tags look like `kiosk-v1.2.3`.

### Auto-update (changed 27 Oct 2026)

The kiosk checks GitHub Releases on every launch — so on every PC restart — and blocks on the splash until the check finishes; an update downloads and installs before the home screen appears. If the check cannot complete (bay PC booted before the network was up) it retries every 2 minutes until one succeeds, then every 6 hours. A download found while someone is playing is held ("Update ready") and installs at the next idle close or the next periodic check that finds the bay free. `bay-app/src/main/updater.ts`.

**Why the install moved from per-machine to per-user.** 1.1.0 and earlier installed to `C:\Program Files` (perMachine). electron-builder then writes `isAdminRightsRequired: true` into `latest.yml`, and electron-updater launches the installer through `elevate.exe` — a UAC prompt on the secure desktop that nobody at a bay can click. The app has already quit by then, so the kiosk goes dark until the prompt times out and the logon task runs again. Per-user installs (`%LOCALAPPDATA%\Programs\tee24-bay-kiosk`) need no elevation, which is how Electron apps are meant to self-update.

Migrating a bay that still has the per-machine 1.1.0: the per-user installer does not touch the `C:\Program Files` copy, so either (a) let the old kiosk auto-update — it installs the per-user copy alongside, relaunches it, and the app re-points the logon task at the new exe (the old folder stays behind, inert; remove it via **Apps & features → Tee24 Bay Kiosk** when convenient) — or (b) on site: uninstall the old one (one UAC click), run the new installer. Settings (`%APPDATA%\tee24-bay-kiosk\tee24-bay-kiosk.json`) survive both. The Clarksville test PC was migrated by hand on 27 Oct. Note that the old 1.1.0 kiosks will auto-update **without** a UAC prompt because the *new* `latest.yml` has no `isAdminRightsRequired`.

Latest as of this note: **1.1.0**, published 23 Oct 2026.

- Page: https://reservations.tee24.golf/desktop-app
- File: https://github.com/robtee24/tee24-booking/releases/download/kiosk-v1.1.0/Tee24-Bay-Kiosk-Setup-1.1.0.exe

SmartScreen warns because the installer is not code-signed. Use **More info → Run anyway**. Leave the Golfin Launcher in Windows startup until Play is proven. Then remove Golfin from startup so the kiosk is the first screen.

Local source may be ahead of 1.1.0. The installer only contains what was tagged. `npm run release` inside `bay-app` builds `release/Tee24-Bay-Kiosk-Setup-*.exe` on a Windows machine. Dev loop on any OS: `npm run dev` in `bay-app`. Packaged kiosk mode is fullscreen; `TEE24_KIOSK_WINDOWED=1` makes a normal window.

## This Mac cannot finish the test

Cursor in the original session was on a Mac. GSPro and the Golfin Launcher are Windows programs. The kiosk starts them by `.exe` path (`bay-app/src/main/launcher.ts`). **Play** fails on macOS because those files do not exist. UI, settings, and poll behavior can be developed on the Mac. Stacking, real GSPro, and the Golfin modal cannot.

Installing Cursor on the bay PC is optional. It lets you edit `bay-app` there. Cursor does not talk to GSPro and cannot inject shots.

## Golfin’s hardware checks are not the kiosk’s

The Golfin Launcher wants an Intel i5 or higher, an NVIDIA GPU, and an IDRA launch monitor on USB. If the IDRA is missing it shows a modal telling the player to connect it, and that modal blocks GSPro.

The kiosk never checks CPU, GPU, or USB. Any Windows 10 or 11 PC can run the installer.

Do not patch Golfin, spoof a USB IDRA, or fake the GPU check. Those gates belong to Golfin. The tests below do not need them defeated.

### Notepad stand-in (lifecycle only)

In kiosk Settings → “What Play launches”, set GSPro to `C:\Windows\System32\notepad.exe`, clear the launch-monitor path, save, press Play.

Notepad opening hides the home screen and shows the right-hand strip. Closing Notepad brings the home screen back. That is the same signal the kiosk uses: “the process I spawned is still alive.” It does **not** reproduce Golfin’s topmost modal, GSPro’s graphics, the “Connected” badge, or a real ball-data session.

The launcher spawns the exe with no shell and no arguments, so a `.bat` file is a poor stand-in. Use a real `.exe` such as Notepad.

## Open concern: our modals must sit on top of Golfin’s

Golfin stays in the test because it is the program connected to GSPro, and its modals draw on top of GSPro. The kiosk’s unlock, 10-minute warning, Help, Schedule, and Export modals have to remain visible above that.

Window code is `bay-app/src/main/windows.ts`.

- **Home** is fullscreen (packaged: kiosk mode). It is not topmost. A Golfin dialog can appear over it.
- **Overlay** (unlock, upcoming, help, schedule, export) and the **toolbar** call `setAlwaysOnTop(true, 'screen-saver')`. On Windows every level above `normal` is the same `HWND_TOPMOST` band. The window that claimed it last is in front. The overlay re-asserts topmost when it is shown, and not on a timer after that.
- Exclusive-fullscreen GSPro can cover even a topmost window. Borderless windowed GSPro usually cannot.
- Help uses the same overlay window as the reservation modals. Help is the stand-in for the z-order test. It does not need a booking.

### How to test z-order

Do this on a bay PC where the Golfin Launcher already opens, on an empty bay. The “connect the IDRA” dialog is the window under test. The launch monitor does not need to be plugged in, and you do not need to get past that dialog into a round. A PC that cannot start Golfin at all cannot complete this test.

1. Leave Golfin in startup. Open it the normal way and leave the connect-IDRA dialog up. Leave GSPro where Golfin put it.
2. Install and open the kiosk. Assign the bay only if nothing is already registered to it.
3. Note whether Golfin’s dialog is still visible on top of the kiosk home screen.
4. Press **Help**. The Help card should cover Golfin.
5. Alt+Tab to Golfin, or click its dialog if any of it is still visible.

Pass: Help stays in front after Golfin is clicked. Fail: Golfin’s dialog comes back in front. If it fails, the next code change is to make the overlay take the screen back when it loses focus (blur / a short re-assert), not to bypass Golfin’s USB check.

## Export does not go through GSPro’s API

`bay-app/src/main/exports.ts` scans for a `.csv` from the last 36 hours, under 2 MB, in:

- Desktop (including OneDrive and Public Desktop)
- Documents, `Documents\GSPro`, OneDrive Documents
- Downloads
- the folder next to the configured GSPro exe, and an `Exports` folder beside it

The header must match at least three of: club, ball speed, carry, launch angle, back spin, club speed, smash, total, offline, spin axis. An “Average” row at the bottom is not counted as a shot. The newest matching file is preselected. Send goes to `POST /api/bay-app/export` on the live reservations server. The device must already be registered. “Send to my Tee24 app” needs a 10-digit phone (or a checked-in booking). Confirm in the Tee24 app under **Improve → Sync latest data**.

Sample file, save as `gspro-test.csv` on the Desktop:

```csv
Club,Ball Speed,Carry,Launch Angle,Back Spin,Club Speed,Total,Offline
Driver,158,265,12.1,2450,108,278,-4
7 Iron,120,168,18.4,6200,86,176,2
Pitching Wedge,98,125,24.0,8100,78,132,1
```

The kiosk should list it as about 3 shots. A success screen means export works. No GSPro process is required for this test.

## Screen reader: what GSPro is showing (added 27 Oct 2026)

GSPro has no API for "which screen am I on" or "how many players", so the kiosk reads the display. `bay-app/resources/screen-ocr.ps1` is a PowerShell worker that uses the built-in Windows OCR (`Windows.Media.Ocr`, no install, ~0.3 s per scan). `bay-app/src/main/screen.ts` spawns it while GSPro is running, scans every 2.5 s (paused while one of our own modals is up), and classifies the screen:

| Screen | Signal (OCR text) | Player count |
| --- | --- | --- |
| `setup` | header `ROUND SETTINGS` | rows with `Team / Color` minus `Empty Slot` dropdowns |
| `round` | top-right hole card `PAR 3..6`, or ≥2 `n yds` rows top-left | number of `… yds` rows in the top-left scoreboard |
| `range` | `DRIVING RANGE` / `SIDE SPIN` / `BACK SPIN`, without a hole card | — |
| `menu` | `WELCOME`, `SELECT COURSE` | — |

A kind has to be seen twice in a row before it counts. Verified against GSPro 3.1.6.20 at 1920×1200; a GSPro redesign that renames those labels will silently turn detection off (screen becomes `unknown`), it will not raise false alarms. **Settings → Test screen reader** on the kiosk runs one scan and shows what it saw. Scans run every 2.5 s on the menu / round settings / range / unknown screens, and back off to every 30 s once a round is under way and the player count is within the allowance (or not enforced); the first scan that shows another screen speeds it up again. Windows PowerShell's `ConvertTo-Json` leaves raw control characters (OCR sometimes emits BEL) that `JSON.parse` rejects — the script strips them and `screen.ts` retries once after stripping, otherwise every scan "times out".

Two features ride on this:

- **Export** in the toolbar is greyed out unless the screen is `range` (that is where GSPro writes shot CSVs).
- **Too-many-players enforcement.** `GET /api/bay-app/status` now includes `currentBooking.players.allowedPlayers` = 1 (booker) + max(membership guest allowance, guests declared on the booking) + every companion member added at the kiosk (1 + their own guest allowance). Non-member bookings have `allowedPlayers: null` and are not enforced. When the GSPro player count exceeds that on the `setup` or `round` screen, the overlay blocks with a modal (wording differs: setup says "your account only allows X players"; in-round says "exit now or be charged"). Options: **Other players are members** (phone entry → `POST /api/bay-app/players {action:'add-member'}`, repeatable, the allowance recomputes), **Remove a player** (setup; hides the modal for 30 s) / **Exit the game** (round; closes GSPro + IDRA + GolfIn and relaunches them exactly like Play, and reports the exit to the admin console with a timestamp, no charge), or tick the mandatory box and **Proceed / Continue**. Both Proceed and Exit create a `GuestViolation` (`POST /api/bay-app/guest-violation` with `action: 'PROCEEDED' | 'EXITED'`) and raise an admin notification (`bay.guest-violation`; WARN for proceeded, INFO for exited). Nothing is recorded. Admins see them under **Troubleshoot → Bay Alerts** for the location; the fee is `UNAUTHORIZED_GUEST_FEE_CENTS` (default 5000) and is **not charged automatically** — the alert is the record, billing is a manual step. Migration `20261027060000_bay_guest_violations`.

## Maintenance restart every Nth inactivity close (added 27 Oct 2026)

When the idle timer closes a session (GSPro and the launch monitor are shut and the kiosk returns home), `poller.ts` bumps `idleCloseCount` in the settings file. When it reaches `restartEveryIdleCloses` (default **4**, admin-editable under **Settings → Restart the PC every N inactivity closes**, `0` disables) the counter resets and the kiosk runs `shutdown.exe /r /f /t 30` and shows a full-screen "This computer is restarting" notice with a 30-second countdown. **Cancel — I'm about to play** runs `shutdown /a` and dismisses it. Only inactivity closes count; a member ending their own session or a schedule change does not. Changing the setting resets the counter.

Each restart is also an update check (see *Auto-update* above), so a bay is never more than one maintenance restart behind the latest release.

**Prerequisite: Windows must sign itself back in.** The kiosk starts from a logon-triggered scheduled task, so after a restart it only reappears once the Windows user is logged on. The Clarksville test PC has no auto-logon configured (`HKLM\...\Winlogon\AutoAdminLogon` is empty) — on that machine the restart would leave the bay at the Windows sign-in screen until someone types the password. Set up auto-logon (Sysinternals `Autologon.exe` stores the password encrypted, or the `AutoAdminLogon` / `DefaultUserName` / `DefaultPassword` registry values) before relying on this, or set the count to `0`.

## Startup guide on the kiosk

**Setup Help → Setup walkthrough** is four illustrated steps (`bay-app/src/renderer/home/GuideArt.tsx`, inline SVG): the wall timer switch (ON/OFF, 5–60 min, 2H/4H), the projector remote, clicking Play on the kiosk, and the GSPro welcome tiles (Practice = range, Local Match = rounds, Challenges = contests; a note that Tournaments need the player's own GSPro account and Online Match links bays). Below that: a hitting-mat callout (hit from the back 2/3, no balls or white objects on or around the mat), the bay's admin notes, and a "Need a hand?" card that shows the location's phone number from **Admin → Location → Settings → Details → Phone** (`location.phone`, sent in `GET /api/bay-app/status`) with "press extension 1". If the phone is blank the card falls back to "the Tee24 number on your confirmation message".

## GSPro Open Connect is not a control API

Docs: https://gsprogolf.com/GSProConnectV1.html

GSPro listens on `127.0.0.1:921`. The launch monitor connects and **pushes** shot JSON (ball speed, spin, launch angles), heartbeats, and ready flags. GSPro replies `200` (shot received) or `201` (player handedness and current club). No authentication. One connector at a time. On a Tee24 bay that connector is already Golfin / Uneekor.

Open Connect does not list sessions, return shot history, write the Export CSV, launch GSPro, or move windows. Injecting made-up shots only draws ball flights inside a GSPro that is already running and waiting for a connector. It does not dismiss Golfin’s dialog and it does not create the file Export reads. Do not build a fake launch monitor for these tests.

## Troubleshooting without Cursor on the PC

The installed app is a normal Windows program.

- Play errors show on the home screen (usually `Not found: <path>`).
- Settings shows whether the GSPro and launch-monitor paths exist. **Test** next to each path launches that one program.
- Log: `C:\Users\<windows user>\AppData\Roaming\tee24-bay-kiosk\logs\main.log` (lower-case, hyphenated folder)
- Settings file in that same folder: `tee24-bay-kiosk.json` (device id, bay assignment, exe paths).
- Start at login: a per-user Task Scheduler task named **Tee24 Bay Kiosk** (immediate at logon). The HKCU Run entry is only used if the task cannot be registered. The Run entry alone left the Windows desktop visible for about 90 s after boot on the test PC.
- Lines tagged `[launcher]`, `[exports]`, or `[remote]` are the useful ones. Paste the tail of `main.log` back into Cursor on the Mac.

Remote desktop from the admin console is optional. On the kiosk: **Settings → Remote support → Install remote support agent** (MeshCentral, outbound only). Then the location’s **Troubleshoot** page can open that PC. Until an agent is reporting, a screenshot plus `main.log` is the path.

### Remote-support server (deployed 27 Oct 2026)

- MeshCentral runs on Fly.io: app `tee24-remote`, region `ord`, one machine, volume `meshcentral_data` (config and DB live on the volume, so the Dockerfile’s `config.json` is only used on first boot). Public URL **https://remote.tee24.golf** (Fly cert issued; CNAME at Bluehost → `tee24-remote.fly.dev`). The site is served by Fly, not Vercel — Vercel is serverless and cannot hold the agents’ persistent WebSockets.
- Deploy from `infra/meshcentral/` (not the repo root, or the Dockerfile’s `COPY config.json` fails): `flyctl deploy --ha=false -a tee24-remote`. flyctl lives at `%USERPROFILE%\.fly\bin\flyctl.exe` on the test PC.
- Account: `tee24` (site admin, rob@tee24.golf). Password is in `%USERPROFILE%\tee24-meshcentral-admin.txt` on the test PC — not in the repo. Reset with `node meshcentral --resetaccount tee24 --pass …` over `flyctl ssh console`.
- Device group: **Tee24 Bays**, id `mesh//s1jG4sPkk0eTlp6qRw7alOr3MfE2zB1YrY4ESxNFM1EJRupfL17fjfIQ$DHYmNIN`. Agent download: `https://remote.tee24.golf/meshagents?id=4&meshid=s1jG4sPkk0eTlp6qRw7alOr3MfE2zB1YrY4ESxNFM1EJRupfL17fjfIQ%24DHYmNIN&installflags=0`.
- Vercel env (what makes the kiosk install button and the admin Troubleshoot deep-link work): `MESHCENTRAL_URL=https://remote.tee24.golf`, `MESHCENTRAL_MESH_ID=<the mesh id above>`, `MESHCENTRAL_ADMIN_USER=tee24`, `MESHCENTRAL_LOGIN_TOKEN_KEY=<output of 'node meshcentral --logintokenkey' on the server>`. Redeploy after setting them.
- **Remote in** opens MeshCentral on the device’s Desktop tab signed in as `tee24`, but MeshCentral has no auto-connect URL flag: the canvas is black with a small “Disconnected” label until you click **Connect**. Two URL gotchas fixed on 27 Oct in `deviceSessionUrl`: `gotonode` must be the bare id (no `node//`), and it must not be percent-encoded — MeshCentral reads the query string raw and discards any value containing `%` (node ids contain `$`).
- GSPro (borderless fullscreen) and the kiosk both capture fine over remote desktop; a black screen is not a capture problem.
- Login tokens are only valid if the signer’s clock is within 30 s behind / 60 min ahead of the server. Vercel is fine; the test PC’s clock was 15 h fast on 27 Oct, which is why a locally signed token was rejected.
- Server-side commands go through `flyctl ssh console -a tee24-remote -C "sh -c '…'"`; `meshctrl` is at `/opt/meshcentral/meshcentral/meshctrl.js` and authenticates with `--loginuser tee24 --loginkey <token key>` against `ws://127.0.0.1:8080`.
- Installing the agent needs one UAC approval on the bay PC. `%USERPROFILE%\tee24-remote-setup.ps1` on the test PC does the clock resync and the agent install in one elevated run.

There is no DevTools shortcut in the packaged app.

## Still untested on real hardware

- Help (and therefore unlock / warning / export) staying above Golfin’s modal after Golfin is clicked.
- Play launching `IDRAMonitor.exe` from the kiosk (as opposed to from a shell), home hiding, **Ctrl+Shift+T**, home returning when GSPro exits.
- GSPro “Connected”, live ball flight, and a CSV produced by GSPro’s own clipboard → Export CSV (as opposed to the sample file).
- Schedule, 10-minute warning, and phone check-in against a real booking on that bay.
- Auto-update from a `kiosk-v*` release.
- Remote-support agent, if MeshCentral is configured.
