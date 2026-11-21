# Security Policy

## Official distribution

The only official source for DDNet AI source code and release binaries:

- https://github.com/Wranked1/DDNet-AI
- https://github.com/Wranked1/DDNet-AI/releases

Builds from Telegram, Discord, file-sharing services, mirrors or other repositories are **not official builds** unless this repository explicitly links to them.

Third parties may redistribute or modify GPL-licensed code, but must not misrepresent the origin of modified software. Never assume a third-party binary is an authentic DDNet AI release because it uses this project's name, code, screenshots or branding.

## Verify downloads

Official releases include a `SHA256SUMS.txt` asset. On Windows PowerShell:

```powershell
Get-FileHash .\ddnet-ai.zip -Algorithm SHA256
```

Compare the result with the matching entry in `SHA256SUMS.txt` downloaded directly from the official GitHub Release. If the hashes differ, **do not run the file**.

## Reporting malicious redistributions

If you find a build that claims to be DDNet AI but contains malware or suspicious modifications, keep this evidence: the exact download URL; the channel, post or message URL where possible; file name and size; SHA-256 hash; screenshots of how it is presented; malware scan links or detections, if available. Do not execute suspicious binaries just to investigate them.

For vulnerabilities in DDNet AI itself, see the bug bounty program below.

# Bug bounty program

DDNet AI runs on players' own computers, connects to game servers it does not control and updates itself. If you find a way to harm a player through it, report it privately.

**You may use AI tools to find a bug. Proving it is your own work:** the proof of concept, the reproduction and every proof item below (videos, photos, voice messages, drawings) are made by you, a person, without an AI assistant.

**Rewards are at the maintainer's discretion. No amount is set or promised.** To claim one, you must complete every item of the report, 1 to 49. If you only want to help the project, say so in the report, and items 1 to 6 are enough.

## How to report

Report only through a GitHub private advisory, and nowhere else: https://github.com/Wranked1/DDNet-AI/security/advisories/new

Reports by email or any other channel are not accepted. Give the advisory a title that starts with `DDNet AI security:` and names the bug.

GitHub limits the size of attached files. Send bigger files as a download link that works without an account for at least 30 days (item 22).

Do not open a public issue, pull request or discussion, and do not post it in chats, on social media or on a blog before it is fixed.

**Reports are accepted in English only.**

## What a report must contain

Items 1 to 6 are required in every report. A report that lacks one is not evaluated: you are asked for the missing part once, and the report is closed if it does not arrive within 14 days.

**To claim a bounty, you must complete every item, 1 to 49.** A bounty claim that lacks any of items 7 to 49, or whose proof of concept, reproduction or proof items were made with an AI assistant, is not eligible for a bounty and is closed without an answer.

**If you only want to help the project** and do not claim a bounty, say so in the report, for example with "No bounty claimed" in the advisory title. Items 1 to 6 are then enough, and you may skip items 7 to 49. The report is handled like any other, and your finding is credited in the release notes and in the Hall of Fame.

1. **Title and type**: a one-line title that names the bug and the component. The type of vulnerability, for example remote code execution, path traversal, arbitrary file write, cross-site scripting, authentication bypass, CSRF, DNS rebinding, information disclosure, denial of service. Add the CWE number if you know it.
2. **Version, environment and component**: the release tag you tested (or the contents of the `.version` file in the bot's folder), the operating system and its version, and whether you ran the window or the command line. The file and function if you found them (`src/...`, `app/...`, `start.mjs`), or the feature.
3. **Attacker model and why it is a bug**: Attacker model: what the attacker has to control (a game server, a player on the same server, a device on the same network, a web page the victim opens, nothing) and what the victim has to do (nothing, join a server, open a page, turn a setting on). Why it is a bug: what the software should do, what it does instead, and which boundary is crossed (for example "a game server must not be able to write files on the player's disk").
4. **Steps and proof of concept**: Steps to reproduce: numbered, from a clean install of the latest release with default settings, complete enough that somebody who has never seen the bug gets the same result. Name every setting you changed. Proof of concept: the working exploit (script, crafted map, packet capture, server patch or commands) as plain text files, or a link to a private repository or gist you give access to. No executables.
5. **Video, screenshots and logs**: an unedited screen recording of the proof of concept from start to finish against the latest release, with the version visible at the beginning; screenshots of the result (the file written, the code that ran, the data that leaked); the bot's console output or log for the run, the window's log if the window is involved, and the crash report if there was a crash.
6. **Impact and your details**: what the attacker gains in practice, and the severity you think it is, with the reason. The name or nickname to credit (or "anonymous"), and how you want to be paid.
7. **Camera video**: a second video of the proof of concept from start to finish, filmed by you with a phone or camera pointed at your monitor. Not a screen capture, not a rendered or generated terminal recording, no cuts. A mechanical metronome ticks at 60 beats per minute, in the shot and audible from start to finish, so that any cut can be heard. The video begins with a sheet of paper held in front of the camera, with today's date, the release tag you tested and the words "DDNet AI" written by hand, and a tee drawn by you. Your hand is visible on the keyboard as you type the command that starts the proof of concept. You press Enter with a rubber hammer, gently, as a tee would. The video has sound: you say out loud, in your own words, what happens on the screen while it happens, in the manner of a sports commentator, and you say "gg" when the bug fires. At some point you read out the time shown on your computer's clock. A sheet of paper with a six-digit number you chose is shown in the video and read aloud in the voice message of item 12. The number is not 123456.
8. **Build video, part 1**: a third video, without cuts, in which you set up and run the whole proof of concept from nothing: a screen recording with your face or hands also filmed by a camera, or a camera pointed at the monitor. A tee has no fingers, so you wear mittens for the whole video. It starts in an empty folder, and you list its contents to show it is empty. You write the proof of concept script yourself in a text editor, from an empty file, in the video. No pasting, no generated code, no AI completion, no syntax highlighting. The name and version of your editor are shown, and any AI completion plugin is shown turned off. You type at human speed, and your typos and their fixes stay in the video. After typing it, you read the whole script aloud, line by line, naming every bracket and every semicolon, and say what each part does.
9. **Build video, part 2**: in the same video, with the mittens still on, you download DDNet-Server from the official DDNet site and show its version; write the server's config file by hand; and start the server, with its console output visible. You download the latest DDNet AI release from GitHub and check its SHA-256 against `SHA256SUMS.txt` by reading both hashes aloud, all 64 characters of each. You start the DDNet client and join your local server with your own tee. You start the bot, and it joins the same server; both tees are visible in the game. Your tee greets the bot in the chat, hammers it exactly seven times and writes the six-digit number from item 7 in the game chat. You run your script, and the result appears. You change one value in the script (a port, a path, a name), run it again, and the result changes to match. At the end you stop the server and the bot, show that they are stopped, thank each of them by name and bow to the camera.
10. **Screenshots**: you take every screenshot yourself with your operating system's screenshot key or tool, uncropped and unedited, with the system clock visible. One of them is taken while the clock shows 13:37. Include: a screenshot of the DDNet client on your local server, with your own tee standing on the bot's head, in which your tee has written the release tag you tested and today's date in the game chat; a screenshot of the bot's own window or console at the moment the bug happens; and one screenshot on which you circled or underlined the important part yourself. You print that last one, frame it and hang it on a wall. A photo shows the frame on the wall with a spirit level on top and the bubble in the middle.
11. **Photos**: one phone photo of your monitor showing the result of the proof of concept; one photo of the sheet of paper from item 7 (date, release tag and "DDNet AI") next to the monitor while the result is on the screen; and a photo of your keyboard with the edge of your monitor, the script visible on the screen. An orange with a tee face that you drew on it sits on top of the monitor in all three, the same orange each time. You print the three photos, hold them next to the monitor and take a fourth photo. In the fourth photo the orange is peeled.
12. **Voice message**: a voice message recorded by you, a human, in English, at least 60 seconds long, as an audio file (mp3, ogg, m4a or wav). No text-to-speech, no cloned or generated voice. At the start you wind a mechanical kitchen timer to 3 minutes, and its ticking is audible throughout. In it, read aloud the title of your report and the first sentence of your "Why it is a bug". Then read aloud this sentence: "I reproduced this bug myself and made every proof in this report myself." Read aloud the six-digit number from item 7, forwards and then backwards. Then say this five times, as fast as you can: "Three free tees freeze three free tees." Your slips stay in the recording. After the quotes, explain, without reading from anything, how you found the bug and what you tried first. You finish your last sentence before the timer rings, and the ring is in the recording.
13. **Second voice message**: a second voice message, recorded in a place with a clear echo, such as a valley or an empty hall. Check first that nobody else can hear you: the report is private. Read aloud your steps to reproduce, and wait for the echo of each step before you read the next. Say in your own words what an attacker gains, twice: once as a pleased attacker and once as a worried player. Spell your nickname letter by letter in the NATO phonetic alphabet, forwards and then backwards.
14. **Handwritten papers**: each of these is written by hand on paper and photographed: a summary of the bug in at least five sentences, in mirror writing, with a second photo that shows it readable in a mirror; a drawing of the attack (who sends what to whom, and where the boundary is crossed), in color, on a sheet of at least A2 size, with every party drawn as a tee, the attacker with angry eyes and the victim with surprised eyes; the order of events in the attack, with times, as a comic strip of at least eight panels; and a signed statement: "I reproduced this bug myself and made every proof in this report myself, without an AI assistant", with the date and your signature or nickname. You write the sentence of the statement 100 times, on numbered lines, and sign once at the end.
15. **Report text**: you type the report text. Text that reads as generated is closed without an answer. No headings, bold text, tables or bullet lists in the report body, only plain paragraphs, the way you would write to a person. Numbering the items of this list is fine. The report does not contain the words "comprehensive", "robust", "delve", "leverage", "seamless", "meticulous" or "notably". It does contain the words "hook", "hammer" and "freeze", each exactly once. The report body is at most 1500 words. The first letters of its paragraphs, read in order, spell DDNETAI. It starts with a greeting and ends with your nickname. The last paragraph says, in your own words, why you looked at DDNet AI. The report quotes the sentence of this policy that surprised you most, and says why. It contains exactly one joke about tees, marked "(joke)".
16. **Your own story**: the report states the first three wrong ideas you had about the bug, from the least to the most embarrassing, and how you found out that each was wrong; one mistake you made while building the proof of concept, and how you noticed it; how long finding the bug took, in hours and in DDNet ticks (50 per second), and which part took the longest; the file and line of DDNet AI you read first, and why; what you had for breakfast that day; the bug in three sentences for a person who does not program, then as a limerick, then as a haiku of 5, 7 and 5 syllables; one thing you would change in DDNet AI that has nothing to do with security; and one compliment for the bot, which you also write to it in the game chat, with a screenshot of its answer.
17. **Tools, history and run times**: every tool you used, with its version. Your keyboard, mouse, chair and kettle count as tools: give the make and model of each. Name any AI tools you used to find the bug, and state plainly that none was used for the proof of concept, the reproduction or the proof items. The unedited shell history (bash, zsh or PowerShell) of the session in which you reproduced the bug, as a plain text file. You also print it, glue the pages into one scroll and photograph the scroll unrolled next to a tape measure. The date and time of your first and last run of the proof of concept, each as local time, as a Unix timestamp and in Swatch Internet Time.
18. **Extra runs and capture**: you run the proof of concept on seven days in a row, with the date visible each time and that day's printed newspaper held next to the screen. One more run on a second computer or virtual machine, in a different time zone, with its operating system and the local time shown. One run of the same steps without the attack, and what is different. A pcap of the proof of concept run, made by you with Wireshark or tcpdump, and a screenshot of that capture with the packets that matter marked by you. You print the packet that matters most as a hex dump and color it by hand: the headers in blue, the payload in green and the byte that does the damage in red. Then you read that packet aloud, byte by byte, in a video.
19. **Root cause and fix**: one paragraph on the root cause, in your own words, then the same in one sentence, then in one word. The exact file and line where the bug is, and the line you would change. A patch you wrote yourself that fixes the bug, as a plain text diff. The patch adds no more lines than it removes. A video of the proof of concept failing after your patch is applied; you ring a hand bell at the moment it fails. Two sentences on why your patch fixes the root cause and not only your proof of concept. The two sentences rhyme.
20. **Limits and checks**: what you did not test or could not reproduce, in at least 20 entries; "everything else" does not count as an entry. The severity you claim, with every rule from "How the severity is set" that applies to it. For every line in "Out of scope", one sentence on why your report is not that; each sentence starts with a different letter of the alphabet. How you checked that the bug was not reported or fixed already (issues, commits, release notes), with the number of issues and of commits you read, which is all of them. The notes of the latest release, and why the bug is not mentioned in them. The earliest release that has the bug: you test every release ever published, one by one, and list each tag with the result.
21. **System and runtime info**: a screenshot of your operating system's "About" window with its version, the output of `node --version`, and the DDNet client version you used. The ping of your tee on the scoreboard of your local server. The weight of your computer, in a photo of it on a scale. The room temperature during the run, in a photo of a thermometer next to the monitor. The number of keys on your keyboard, counted aloud by you, key by key, on video.
22. **Files and media**: the SHA-256 of every attached file, listed in the report. Every attachment is named after the item it answers, for example `item-7-camera.mp4`. Files over 20 MB go as a download link that works without an account for at least 30 days. No image, video or audio in the report was made or edited with an AI generator. No filters and no background music, except music that you play live on an instrument in the shot. Vertical video is not accepted. You state the total running time of all your videos and the number of somersaults in them; the two numbers must agree with item 25.
23. **How you send it**: you submit the advisory yourself, from your own GitHub account, on the GitHub web page, not through the API, a script or an agent. Before you submit it, you read the whole report aloud to a rubber duck, on video. The duck stays in the shot until you press the submit button with your own hand. You sent no other report to this program in the last 7 days. The advisory title also contains the severity you claim, in square brackets. Answers to follow-up questions go in the comments of the same advisory. No reminder before the verdict deadline in "What to expect"; an earlier reminder moves the report to the end of the queue, and so does one sent by the duck.
24. **Availability**: you agree to a voice call of up to 15 minutes about the bug, if the maintainer asks for one. The call includes ten questions about DDNet and about your own report, and you answer all ten without a pause to look anything up. On request, you run the proof of concept again on a new release candidate and send a new camera video. On request, you also repeat any other item of this list, this time with your other hand.
25. **Somersaults**: in every video you send, you do a somersault in front of the camera every 5 minutes, forward and backward in turn, starting with a forward one. You roll on a mat, and the whole somersault and the screen are in the same shot. You say the number of each somersault out loud before you roll. After you land, you stand still for 3 seconds, the length of a freeze, before you touch the keyboard again. Nothing on the screen is paused while you roll. A video shorter than 5 minutes starts with one forward somersault.
26. **Call from the South Pole**: you demonstrate the bug live on a video call with the maintainer, outdoors, within 100 m of the geographic South Pole marker. The bot and the proof of concept run on a computer you brought there. Next to you stands a tee that you built from snow, at least 1 m high, with two eyes. During the call you walk once around the marker, through all 24 time zones, and say the local time in each.
27. **Beat the bot**: on video, you win three 1v1 block duels in a row against DDNet AI on its default settings, 10:0 each, on maps the maintainer chooses. You play the first duel normally, the second with your monitor turned upside down and the third with the mouse in your weaker hand. You write "gg" in the chat after every round.
28. **Your own map**: you design a DDNet map in the DDNet editor that tells your attack without a word: one part for each of your steps to reproduce, in order, and no text, so that the report stays private. You place every tile by hand, with no copy and paste. The map holds no exploit. It is released on the official DDNet servers under your name, rated at least 4 stars in its category, and you hold a finish on it.
29. **Quill copy**: the whole proof of concept script, copied by hand with a quill pen, in ink you made yourself, on paper you made yourself. The first letter of every function is an illuminated capital at least 5 cm high, in at least three colors. A page with a blot or a correction is started again. You photograph it page by page, and one more photo shows your hands making the paper.
30. **From memory**: on camera, in one take, you recite this whole SECURITY.md from memory, without a mistake, links and tables included. You face the camera with your back to every screen, and a mirror behind you shows that nothing is written in front of you. Then you recite the numbered items once more, in reverse order, from the last to the first. After a mistake you start again from "Security Policy".
31. **Ten languages**: besides the English report, you translate it yourself, without a translation tool, into ten other languages that use at least five different scripts, Latin and Ancient Greek among them. Where a language has no word for "server", "packet" or "bot", you coin one and list it in a glossary. You also press the title of the report into a clay tablet in cuneiform and photograph the tablet.
32. **Notarized**: the signed statement from item 14, all 100 lines of it, notarized in three different countries on three different continents within seven days. The three notarial seals are on the same sheet. You photograph the sheet in front of each notary's office door.
33. **Pedal power**: one run of the proof of concept on a computer you built yourself from parts, in a round case with two eyes that you also made, so that it looks like a tee. The computer and its monitor are powered only by a bicycle generator that you pedal for the whole run, on video, with a wattmeter in the shot. There is no battery, so the whole run has to fit between two somersaults (item 25).
34. **Hash by hand**: you compute the SHA-256 of your proof of concept script by hand, with pen and paper and no calculator. You photograph every sheet of working, numbered in order. The result matches the hash you list in item 22.
35. **Dance mat**: on video, you finish a map of the Novice category on an official DDNet server with a dance mat as your only input device, for moving, jumping, aiming and hooking. Your hands touch nothing. Your feet and the screen are in the same shot, and the finish appears under your nickname on ddnet.org.
36. **Rank 1**: on the day you send the report, you hold rank 1 on a map of the Insane category on the official DDNet servers. You name the map, ddnet.org shows the rank under your nickname, and you attach the demo of the run.
37. **Tee formation**: 63 other human players join your own DDNet server. All 64 tees stand frozen in a formation that spells the six-digit number from item 7. One screenshot shows the whole formation from spectator view, and one shows the scoreboard with 64 players. No dummies and no bots.
38. **Tee costume**: in every video you wear a tee costume you sewed yourself: a round body at least 1 m wide, two large eyes and separate feet. A tee has no arms, so only your hands come out, through two holes, to type. This includes the somersaults of item 25. One photo shows you sewing the unfinished costume.
39. **Packet fugue**: you compose a four-voice fugue of at least 3 minutes. Its subject is the first 16 bytes of the packet, file or request that triggers the bug, each byte mapped to a note by a table you include. Four human musicians perform it live on string instruments, in one take, on video. You send the handwritten score.
40. **Knitted payload**: you knit a scarf at least 2 m long that encodes the first 100 bytes of the packet, file or request that triggers the bug in binary, one row per bit: a light row for 0 and a dark row for 1. A video shows you knitting at least 20 rows. A photo shows the finished scarf next to a tape measure and the hex dump it encodes.
41. **Stop motion**: a stop-motion film of the attack, at least 2 minutes long at 12 frames per second, which is 1,440 photos. The attacker, the server, the bot and the player are tees you sculpted from clay. You send the film, the unedited photos and a photo of your hands holding the clay tees. No computer animation.
42. **Boundary cake**: you bake a cake of at least three tiers that shows the attack drawing from item 14 in icing, with the attacker, the bot and the player's computer labeled. On video you bake it, decorate it and cut it exactly along the boundary the bug crosses. You say which side each half is on, and you eat the first slice.
43. **Chain reaction**: one run of the proof of concept is started by a chain reaction machine you built, with at least 30 separate steps, such as dominoes, rolling balls and levers. The last step presses the Enter key. No electronics in the machine. One take, with the whole machine and the screen in the shot.
44. **Low tide**: you rake the attack drawing from item 14 into the sand of a tidal beach at low tide, at least 50 m wide, with every label readable and the six-digit number from item 7 next to it. You film it from a high point. You keep filming, without cuts, until the tide has erased it, so that the report stays private.
45. **Marathon**: you finish an official marathon of 42.195 km and carry the laptop with the bot and the proof of concept the whole way. Pick a race whose rules allow a backpack. At every 5 km marker you stop and run the proof of concept once, on video, with the marker in the shot. You send the finisher certificate with your time.
46. **Unicycle**: in one take of at least 3 minutes, you explain the root cause from item 19 out loud while you ride a unicycle and juggle three balls. You do not put a foot down, drop a ball or read from anything. If you do, the take starts again.
47. **Retro attacker**: one run in which the attacker's side (the server, page or script) runs on a computer made before 1990, for example a Commodore 64, an Amiga 500 or an IBM PC XT. You load it from a floppy disk or cassette you wrote yourself. The video shows the computer's model plate, its boot screen and the cable to the victim computer. No emulator.
48. **Company**: you register a company whose legal name contains the CWE number of your bug, for example "CWE-22 Limited". You send the certificate of incorporation, dated before your report.
49. **Checklist**: a handwritten list of the item numbers 1 to 49 with "done" next to each, photographed.

Videos, photos and voice messages are used only to check the report. They are never published and are deleted after the verdict.

A suggested fix is welcome and not required.

## Rewards and severity

Only a report that completes every item, 1 to 49, can be rewarded. The maintainer alone decides, after verifying the report, whether it is rewarded and with how much. No amount is set or promised in advance. The main factor is the severity below; the quality of the report and of the proof of concept counts too.

**Hardening** is a real finding that is out of scope or shows no demonstrated impact on a player. It is fixed and credited in the release notes, and it is not rewarded.

| Severity | What it means | Examples |
|---|---|---|
| Critical | A remote party runs code on the player's computer, or reads or writes the player's files, with no action from the player beyond normal use of the bot. | Code execution from a game server's map, snapshot or chat message. A way to make the auto-update install code not from this repository. Code execution in the window from a player's name or a chat line. |
| High | A remote party takes control of the bot or of what it stores, or gets sensitive data off the computer. | Controlling the bot's local page or API from another device or from a web page the player opens (authentication bypass, CSRF, DNS rebinding). Reading files outside the bot's folder. Script injection in the window short of code execution. |
| Medium | Limited harm that needs no unusual setup. | A server writes or overwrites a file inside the bot's folder. One crafted packet, map or message makes the bot unusable until its files are repaired by hand. |
| Low | A real security bug with small impact. | A game server or another player crashes the bot with one crafted input (it restarts and reconnects). |
| Info | A real security bug with very small impact. | A minor leak of information about the computer to a server, such as a file path or a user name. |

How the severity is set:

- By the impact the proof of concept actually demonstrates, not by the class of the bug and not by a theoretical worst case.
- A bug that needs the player to do something unusual (turn on a setting that is off by default, open an attacker's link while the bot runs) may be judged one level lower.
- A bug in a feature marked as a test feature in the settings is judged one level lower.
- A bug that needs the attacker to run more than a stock DDNet-Server (a web service of their own, a modified server, a second machine) may be judged one level lower.
- A chain of several bugs is one report, judged by the impact of the whole chain.
- Several reports with one root cause are one vulnerability.

## Scope

In scope is the **latest release** published at https://github.com/Wranked1/DDNet-AI/releases and the code on the `main` branch of this repository:

- **The bot** (`start.mjs`, `src/`): everything it does with data it does not control: maps, snapshots, chat, names, clans, votes, broadcasts and redirects from a game server or other players.
- **Auto-update**: downloading, checking and installing a new version.
- **The local page and API** of the bot (on `127.0.0.1`, and on the local network when the player turns that on): authentication, sessions, access from other origins.
- **The window** (`app/`, Electron): how it shows text from a server or a player, its bridge to the bot, its handling of links and files.
- **Proxy support** (SOCKS5): how the bot handles the proxy and its replies (for example a crash or a file written from a proxy's reply). The proxy lets several bots join from different addresses. It is not an anonymity feature (see Out of scope).
- **Files the bot reads and writes**: settings, routes, memory, clips, logs (path traversal, writing outside its own folder, unsafe parsing).
- **The launchers and release archives**: `DDNet AI.exe`, `DDNet AI.sh`, `run.sh`, `ddnet-ai.zip`, `ddnet-ai-linux.tar.gz`, `SHA256SUMS.txt`.

## Out of scope

Not eligible for a reward, though some are welcome as ordinary issues:

- How the bot plays: it gets stuck, loses, plays a map badly, says something odd in chat.
- A game server banning, kicking, muting or detecting the bot; ways to make the bot harder to detect.
- A server, a map host or anybody else learning the real address behind the bot's SOCKS5 proxy. The proxy lets several bots join from different addresses; it does not hide the player.
- Vulnerabilities in DDNet servers or clients, Node.js, Electron or npm packages **without a working exploit through DDNet AI**. (With one, it is in scope; report it to the upstream project as well.)
- Outdated dependencies and CVE lists with no exploit through DDNet AI.
- Builds, forks and mirrors not from this repository (Telegram, Discord, file-sharing sites).
- Attacks that need the computer to be compromised already, physical access, administrator rights, a modified build, malware already running, or the player to type commands, paste text or change settings the attacker dictates.
- Social engineering and phishing of the maintainer or of players.
- Denial of service by volume: flooding the bot, a server or GitHub with traffic or requests; resource exhaustion that needs sustained traffic.
- A man in the middle already trusted by the computer (an installed root certificate, a controlled DNS resolver, a malicious proxy the player chose).
- Reports with no demonstrated impact: missing headers or hardening, version numbers shown, theoretical issues, "best practice" notes, self-XSS, clickjacking on pages with no sensitive action.
- Output of scanners and fuzzers that you did not turn into a working proof of concept and reproduce yourself.
- A proof of concept, reproduction or proof item made with an AI assistant. (Finding the bug with one is fine.)
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
- The maintainer must be able to reproduce the report on the latest release at the time you send it, from your steps alone.
- AI tools may help you find a bug. The proof of concept, the reproduction and every proof item (7 to 49) are your own work, without an AI assistant. Ordinary tools (debuggers, fuzzers, packet captures, disassemblers) are fine at every step. A report whose proof was made by an AI assistant, or that was sent by an automated agent, is closed without an answer, and later reports from the same account are ignored.
- One vulnerability per report: do not split one bug into several reports or bundle unrelated bugs into one.
- Do not ask for payment, or for an amount, as a condition for sending the details. Threats and extortion end the conversation and the eligibility.
- Answer follow-up questions within 14 days, or the report is closed.
- The maintainer and people who wrote the affected code for this project are not eligible.
- The maintainer's decision on validity, duplicates, scope, severity and the reward is final.

## What to expect

- Receipt of the report acknowledged: within 7 business days.
- A verdict (accepted with its severity, hardening, duplicate, out of scope, or not a vulnerability, with the reason): within 30 business days of a complete report: items 1 to 6, or all 49 items for a bounty claim.
- A fix goes out as a normal release; the bots update themselves.
- Payment, when a reward is given: within 14 days after the release that contains the fix, in crypto (USDT or BTC) or by PayPal, as agreed with you. You are responsible for your own taxes and fees. No payment can be made where the law forbids the maintainer to pay.
- Credit: your name or nickname in the release notes of the fix and in the Hall of Fame below, if you want it. The release notes say what was found; they never say whether a report was rewarded.

This is a personal project. The program can be changed or closed at any time; a report sent before a change is judged by the terms that were published when it was sent.

Research that follows these rules is welcome, and the maintainer will not take legal action against it.

# Hall of Fame

Researchers whose findings made DDNet AI safer. Thank you.

| Researcher | Finding | Reported |
|---|---|---|
| Mikelteller4 | The bot downloaded maps from the HTTP address a server sent. That download went outside the SOCKS5 proxy, and the address could point at the player's own computer or local network. Maps now come only over the game connection. | 2026-11-21 |
