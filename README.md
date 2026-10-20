# Secure Document Vault

An offline, encrypted document vault that runs in Chrome on Android.
This repository contains CODE ONLY. Your documents never leave your device.

## Run on a PC for testing
    python -m http.server 8000
Open http://localhost:8000 in Chrome.

## Install on Android
1. Open the GitHub Pages address in Chrome on the tablet (online, once).
2. Wait a few seconds so the offline cache is saved.
3. Chrome menu > "Add to Home screen" / "Install app".
4. Turn on airplane mode and open the app from its icon to confirm it works offline.

## Updating
1. Change the code.
2. Change CACHE in sw.js (e.g. 'vault-v2').
3. Commit and push.
4. Open the app online once and reload.
