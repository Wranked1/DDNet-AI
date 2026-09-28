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

For vulnerabilities in the official repository, use GitHub's private vulnerability reporting feature when available. Do not publish exploitable details in a public issue before the maintainer has had a chance to review them.
