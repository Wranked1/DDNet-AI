# Security Policy

## Official distribution

The only official source for DDNet AI source code and release binaries is:

- https://github.com/Wranked1/DDNet-AI
- https://github.com/Wranked1/DDNet-AI/releases

Builds distributed through Telegram, Discord, file-sharing services, mirrors, or other repositories are **not official builds** unless this repository explicitly links to them.

Third parties may redistribute or modify GPL-licensed code, but they must not misrepresent the origin of modified software. A third-party binary should never be assumed to be an authentic DDNet AI release merely because it uses this project's name, code, screenshots, or branding.

## Verify downloads

Official releases include a `SHA256SUMS.txt` asset.

On Windows PowerShell:

```powershell
Get-FileHash .\ddnet-ai.zip -Algorithm SHA256
```

Compare the result with the matching entry in `SHA256SUMS.txt` downloaded directly from the official GitHub Release.

If the hashes differ, **do not run the file**.

## Reporting malicious redistributions

If you find a build that claims to be DDNet AI but contains malware or suspicious modifications, keep the following evidence:

- the exact download URL;
- channel/post/message URL where possible;
- file name and size;
- SHA-256 hash;
- screenshots of how it is presented;
- malware scan links or detections, if available.

Do not execute suspicious binaries just to investigate them.

For vulnerabilities in DDNet AI itself, see the bug bounty program below.

# Bug bounty program

DDNet AI runs on players' own computers, connects to game servers it does not control and updates itself. If you find a way to harm a player through it, report it privately.

**Rewards are discretionary, up to a maximum of $500 per report.** Whether an accepted report is rewarded, and with how much, is decided by the maintainer alone after the report is verified. No amount is promised in advance.

## How to report

Send the report through one of these two private channels, and nowhere else:

- email: **wranked.1@gmail.com** (subject: `DDNet AI security: <short title>`);
- GitHub private advisory: https://github.com/Wranked1/DDNet-AI/security/advisories/new

Do not open a public issue, pull request or discussion about it, and do not post it in chats, on social media or on a blog before it is fixed.

**Reports are accepted in English only.**

## What a report must contain

Every item below is required. A report that lacks one is not evaluated: you are asked for the missing part once, and the report is closed if it does not arrive within 14 days.

1. **Title**: one line that names the bug and the component.
2. **Type of vulnerability**: for example remote code execution, path traversal, arbitrary file write, cross-site scripting, authentication bypass, CSRF, DNS rebinding, information disclosure, denial of service. Add the CWE number if you know it.
3. **Affected version and environment**: the release tag you tested (or the contents of the `.version` file in the bot's folder), the operating system and its version, and whether you ran the window or the command line.
4. **Affected component**: the file and function if you found them (`src/...`, `app/...`, `start.mjs`), or the feature.
5. **Attacker model**: what the attacker has to control (a game server, a player on the same server, a device on the same network, a web page the victim opens, nothing) and what the victim has to do (nothing, join a server, open a page, turn a setting on).
6. **Why it is a bug**: what the software is expected to do, what it does instead, and which boundary is crossed (for example "a game server must not be able to write files on the player's disk").
7. **Steps to reproduce**: numbered, from a clean install of the latest release with default settings, complete enough that somebody who has never seen the bug gets the same result. Name every setting you changed.
8. **Proof of concept**: the working exploit itself: the script, crafted map, packet capture, server patch or commands. Attach it as plain text files, or as a link to a private repository or gist you give access to. Do not send executables.
9. **Video**: an unedited screen recording of the proof of concept running from start to finish against the latest release, with the version visible at the beginning.
10. **Screenshots**: of the result (the file that was written, the code that ran, the data that leaked).
11. **Logs**: the bot's console output or log for the run, the window's log if the window is involved, and the crash report if there was a crash.
12. **Impact**: what the attacker gains in practice, and the severity you think it is, with the reason.
13. **Your details**: the name or nickname to credit (or "anonymous"), and how you want to be paid.

A suggested fix is welcome and not required.

## Rewards and severity

The reward for an accepted report is set by the maintainer, at the maintainer's sole discretion, from nothing up to **$500**. The main factor is the severity below; the quality of the report and of the proof of concept counts too. The severity tiers are a guide to how a report is judged, not a price list.

| Severity | What it means | Examples |
|---|---|---|
| Critical | A remote party runs code on the player's computer, or reads or writes the player's files, with no action from the player beyond normal use of the bot. | Code execution from a game server's map, snapshot or chat message. A way to make the auto-update install code that is not from this repository. Code execution in the window from a player's name or a chat line. |
| High | A remote party takes control of the bot or of what it stores, or gets sensitive data off the computer. | Controlling the bot's local page or API from another device or from a web page the player opens (authentication bypass, CSRF, DNS rebinding). Reading files outside the bot's folder. Script injection in the window that stops short of code execution. |
| Medium | Limited harm that needs no unusual setup. | The player's real IP address leaks past a configured proxy. A file is written or overwritten inside the bot's folder by a server. One crafted packet, map or message makes the bot unusable until its files are repaired by hand. |
| Low | A real security bug with small impact. | A game server or another player crashes the bot with one crafted input (the bot restarts and reconnects). A minor leak of information about the computer. |

How the severity is set:

- By the impact the proof of concept actually demonstrates, not by the class of the bug and not by a theoretical worst case.
- A bug that needs the player to do something unusual (turn on a setting that is off by default, open an attacker's link while the bot runs) may be judged one level lower.
- A bug in a feature marked as a test feature in the settings is judged one level lower.
- A chain of several bugs is one report, judged by the impact of the whole chain.
- Several reports with one root cause are one vulnerability.

## Scope

In scope is the **latest release** published at https://github.com/Wranked1/DDNet-AI/releases and the code on the `main` branch of this repository:

- **The bot** (`start.mjs`, `src/`): everything it does with data it does not control: maps, snapshots, chat, names, clans, votes, broadcasts and redirects from a game server or from other players.
- **Auto-update**: downloading, checking and installing a new version.
- **The local page and API** of the bot (on `127.0.0.1`, and on the local network when the player turns that on): authentication, sessions, access from other origins.
- **The window** (`app/`, Electron): how it shows text that comes from a server or a player, its bridge to the bot, its handling of links and files.
- **Proxy support** (SOCKS5): traffic that leaves outside the configured proxy.
- **Files the bot reads and writes**: settings, routes, memory, clips, logs (path traversal, writing outside its own folder, unsafe parsing).
- **The launchers and release archives**: `DDNet AI.exe`, `DDNet AI.sh`, `run.sh`, `ddnet-ai.zip`, `ddnet-ai-linux.tar.gz`, `SHA256SUMS.txt`.

## Out of scope

Not eligible for a reward, though some of these are welcome as ordinary issues:

- How the bot plays: it gets stuck, loses, plays a map badly, says something odd in chat.
- A game server banning, kicking, muting or detecting the bot; ways to make the bot harder to detect.
- Vulnerabilities in DDNet servers or clients, Node.js, Electron or npm packages **without a working exploit through DDNet AI**. (With one, it is in scope; report it to the upstream project as well.)
- Outdated dependencies and CVE lists with no exploit through DDNet AI.
- Builds, forks and mirrors that are not from this repository (Telegram, Discord, file-sharing sites).
- Attacks that need the computer to be compromised already, physical access, administrator rights, a modified build, malware already running, or the player to type commands, paste text or change settings the attacker dictates.
- Social engineering and phishing of the maintainer or of players.
- Denial of service by volume: flooding the bot, a server or GitHub with traffic or requests; resource exhaustion that needs sustained traffic.
- A man in the middle who is already trusted by the computer (an installed root certificate, a controlled DNS resolver, a malicious proxy the player chose).
- Reports with no demonstrated impact: missing headers or hardening, version numbers shown, theoretical issues, "best practice" notes, self-XSS, clickjacking on pages with no sensitive action.
- Output of scanners, fuzzers and AI tools that you did not turn into a working proof of concept and reproduce yourself.
- Old releases, when the latest one is not affected; development tools, tests and scripts that are not part of a release.
- Information the bot shares on purpose: its name and clan, the message that says it is a bot, the client identification it sends to servers.
- Bugs already known to the maintainer, already fixed on the development branch, or already reported by somebody else.
- GitHub, Telegram, PayPal and other services this project only uses.

## Rules

- Test only on your own computer, against your own local DDNet server. Never test against other players, public game servers or anybody's infrastructure.
- Do not read, change or destroy data that is not yours.
- Keep the vulnerability private until a fix is released, or for 90 days from your report, whichever comes first. Publishing or sharing it earlier forfeits the reward.
- After the fix is released you may publish your write-up; please wait 14 days so that the bots have updated.
- Only the first complete report of a vulnerability is eligible. A duplicate is told so, with the date of the first report.
- The report must be reproducible on the latest release at the time you send it, by the maintainer, from your steps alone.
- You must have found and verified the bug yourself. Using tools, AI included, is fine; sending their unverified output is not, and repeated low-quality reports are ignored.
- One vulnerability per report. Do not split one bug into several reports, and do not bundle unrelated bugs into one.
- Do not ask for payment, or for an amount, as a condition for sending the details. Threats and extortion end the conversation and the eligibility.
- Answer follow-up questions within 14 days, or the report is closed.
- The maintainer and people who wrote the affected code for this project are not eligible.
- The maintainer's decision on validity, duplicates, scope, severity and the reward is final.

## What to expect

- An answer that the report was received: within 7 days.
- A verdict (accepted with its severity, duplicate, out of scope, or not a vulnerability, with the reason): within 30 days of a complete report.
- A fix goes out as a normal release; the bots update themselves.
- Payment, when a reward is given: within 14 days after the release that contains the fix, in crypto (USDT or BTC) or by PayPal, as agreed with you. You are responsible for your own taxes and fees. No payment can be made where the law forbids the maintainer to pay.
- Credit: your name or nickname in the release notes of the fix, if you want it.

This is a personal project. The program can be changed or closed at any time; a report sent before a change is judged by the terms that were published when it was sent.

Research that follows these rules is welcome, and the maintainer will not take legal action against it.
