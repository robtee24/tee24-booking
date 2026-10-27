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

Windows installer only (NSIS, x64, per-machine, unsigned). GitHub Actions workflow: `.github/workflows/kiosk-release.yml`. Tags look like `kiosk-v1.2.3`.

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

Remote desktop from the admin console is optional. On the kiosk: **Settings → Remote support → Install remote support agent** (MeshCentral, outbound only). Then the location’s **Troubleshoot** page can open that PC, once Tee24’s MeshCentral server is configured. Until an agent is reporting, a screenshot plus `main.log` is the path.

There is no DevTools shortcut in the packaged app.

## Still untested on real hardware

- Help (and therefore unlock / warning / export) staying above Golfin’s modal after Golfin is clicked.
- Play launching `IDRAMonitor.exe` from the kiosk (as opposed to from a shell), home hiding, **Ctrl+Shift+T**, home returning when GSPro exits.
- GSPro “Connected”, live ball flight, and a CSV produced by GSPro’s own clipboard → Export CSV (as opposed to the sample file).
- Schedule, 10-minute warning, and phone check-in against a real booking on that bay.
- Auto-update from a `kiosk-v*` release.
- Remote-support agent, if MeshCentral is configured.
