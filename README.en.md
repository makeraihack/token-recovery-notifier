# Token Recovery Notifier

English | [日本語](./README.md)

A Windows tray app that watches for the Claude Code CLI usage limit (session/weekly rate limit) and sends a Windows toast (Action Center) notification the moment it resets.

## What this app does

If you use Claude Code CLI regularly on Windows, you've probably had to set a manual timer or occasionally peek at the terminal to see if your rate limit has reset. This app watches the session logs Claude Code CLI writes locally (`~/.claude/projects/**/*.jsonl`), detects rate-limit-hit records, and sends a Windows toast notification right when the reset time arrives.

- Detects rate limits across multiple projects (multiple working folders) if you use Claude Code in more than one.
- Runs resident in the system tray. Once you approve the UAC prompt on first launch, it starts automatically on Windows sign-in from then on.
- Notifications are entirely local. No external push notification service or extra credentials are used.

For the background and technical research behind this project, see [`CONCEPT.md`](./CONCEPT.md), [`PLAN.md`](./PLAN.md), and [`RESEARCH.md`](./RESEARCH.md) (Japanese only).

## Requirements

- **OS**: Windows 10 / 11 (Windows only — macOS/Linux are not supported)
- **Node.js**: 20.x or later (if running from source; developed and tested on the v24.x line)
- **PowerShell**: 5.1 or later (works with the version bundled in Windows — no extra install needed)
- **Claude Code CLI**: a version that writes session logs to `~/.claude/projects/**/*.jsonl` (any current standard installation should be fine)

## Installation / Setup

### Option A: Portable build (no Node.js install required for the download step)

1. Download the portable zip (`token-recovery-notifier-portable-win-x64-vX.Y.Z.zip`) from [Releases](#about-the-distribution-format) and extract it to any folder.
2. Double-click `TokenRecoveryNotifier.cmd` inside the extracted folder to launch it.

    > The portable build does not bundle a Node.js runtime. **Node.js 20.x or later must already be installed** (get it from [nodejs.org](https://nodejs.org/)). This is not a single self-contained executable — see "About the distribution format" below for why.

### Option B: Run from source

```powershell
git clone <this repository's URL>
cd token-recovery-notifier
npm install
npm run build
npm start
```

If you want to run the TypeScript directly during development, `npm run dev` also works (runs via `tsx` with no separate build step).

## Usage

- Once started, an icon appears in the system tray (if you don't see it, check "Show hidden icons").
- On first launch, the app tries to register a Task Scheduler task so it starts automatically on Windows sign-in. Creating this task (a task with a logon trigger) **requires administrator privileges**, so a standard Windows UAC prompt appears. Choose "Yes" to complete the registration; from then on it starts automatically at sign-in.
    - If you chose "No" on the UAC prompt, or want to (re-)register it later, right-click the tray icon and choose **"Register logon-time startup..."** — you can retry this at any time.
    - The app still works fine without this registration; you'll just need to start it manually each time.
- When Claude Code CLI hits a rate limit, the app detects it in the background and sends a Windows toast notification at the scheduled reset time.
- If a rate limit was already in effect when the app started (e.g. you were away from your PC) and the reset time is still in the future, the app detects it on startup and schedules the notification.
- To **quit**, right-click the tray icon and choose "Exit" from the menu.
- Logs are written to `%USERPROFILE%\.token-recovery-notifier\app.log`. If something seems off, check there first. Once it exceeds 5MB it's automatically rotated to `app.log.1` (keeping one previous generation), so it won't grow indefinitely.

## Uninstalling

1. Double-click `Uninstall.cmd` inside the portable build's folder (or run `npm run uninstall` if running from source).
2. Review what it's about to do and type `y` to continue. It will automatically:
    - Stop the app if it's running
    - Remove the logon-time startup task (**requires administrator privileges, so a UAC prompt appears** — choose "Yes")
    - Remove any leftover legacy registry Run key registration from an older version
    - Delete `%USERPROFILE%\.token-recovery-notifier` (the log file and settings)
3. Finally, delete the app's own folder (the one containing `dist` and `node_modules`) yourself whenever you're ready — it's just files, so it's safe to delete at any time.

## Setting up Slack notifications (optional)

In addition to the Windows toast notification, you can also send a notification to Slack at the same time. If you don't configure this, the app keeps working exactly as before with Windows Toast only (no errors).

1. Create an **Incoming Webhook** in your Slack workspace and get the Webhook URL (`https://hooks.slack.com/services/...`). See Slack's official docs ([Sending messages using Incoming Webhooks](https://api.slack.com/messaging/webhooks)) for the steps.
2. Create `%USERPROFILE%\.token-recovery-notifier\config.json` with the Webhook URL in the following format (create the `.token-recovery-notifier` folder first if it doesn't exist):

    ```json
    {
      "slackWebhookUrl": "https://hooks.slack.com/services/xxxxx/xxxxx/xxxxxxxxxxxxxxxxxxxxxxxx"
    }
    ```

3. Restart the app to apply the setting. From then on, both Windows Toast and Slack will receive a notification whenever the rate limit resets.

If `config.json` doesn't exist, or `slackWebhookUrl` is unset/empty, Slack notifications are simply skipped and the app logs a one-time notice about it at startup (the app itself does not error out, and Windows Toast notifications keep working).

## Known limitations (honest disclosure)

- **Relies on an unofficial internal file format.** The content and wording of the session logs Claude Code CLI writes to `~/.claude/projects/**/*.jsonl` are part of the CLI's internal implementation, not an officially supported Anthropic API. If the format changes in a future CLI version, detection may stop working correctly (the app logs a warning when it detects a format mismatch, but detection itself could stop entirely).
- **The weekly rate-limit message format is unverified.** The session (5-hour) rate limit message has been confirmed against real data, but no real example of the weekly rate-limit message has been observed yet (see [`RESEARCH.md`](./RESEARCH.md) for details). Notifications may not work correctly if you only hit the weekly limit.
- **Timezone parsing assumes the `Etc/GMT±N` format.** All real data observed so far has used this format. If a different format appears, the app logs a warning and ignores it — a deliberately conservative choice to avoid notifying at a wrong, guessed time.
- Notifications only tell you "the limit has reset." There is no "auto-resume" feature that automatically sends a prompt once the limit clears (this is intentionally out of scope).
- Multi-account support (monitoring more than one Claude Code account at once) is not implemented yet.
- **No automatic recovery from crashes or forced termination.** If the app process dies for any reason, it will not restart automatically until the next Windows sign-in (there is no periodic health check). If you're worried it may have stopped, check whether the tray icon is still there.
- **Registering logon-time startup requires administrator privileges (UAC).** Because it relies on creating a Task Scheduler task with a logon trigger, a UAC prompt appears on first launch. On machines where UAC interaction isn't available (e.g. some corporate PCs), auto-start registration won't be possible and you'll need to start the app manually each time.

## About the distribution format

For Windows distribution, this project uses a **portable zip** bundling the built JS, production `node_modules`, and a `.cmd` launcher.

A single self-contained executable (using `pkg` / `@yao-pkg/pkg` etc. to bundle the Node.js runtime into one exe) was also considered, but `node-notifier` — used for Windows toast notifications — spawns a bundled executable (`snoretoast-x64.exe`) as an external process internally. Placing that inside a virtual snapshot filesystem like the one `pkg` uses carries a real risk of it failing to launch as an actual process. Since this is still an early-stage open-source release, reliability and ease of verification were prioritized over a single-file build, so the portable zip approach — bundling `node_modules` as real files — was chosen instead (a self-contained executable build remains a candidate for future improvement).

## License

Released under the [MIT License](./LICENSE). Free to use, modify, and use commercially.

## Support / Donations

If you find this useful, support via [GitHub Sponsors](https://github.com/sponsors/makeraihack) is appreciated (a donation link will also be added when the accompanying note article is published).
