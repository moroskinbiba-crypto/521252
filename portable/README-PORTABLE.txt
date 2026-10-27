TGRMLither Portable v1.3.2

QUICK START
1. Extract this folder anywhere.
2. Windows: double-click Launch-TGRMLither.bat.
3. macOS/Linux: run ./Launch-TGRMLither.sh.
4. The launcher checks port 8765, starts the local server, and waits until it responds before opening the browser.

REQUIREMENT
Python 3 is used only to serve the local files to the browser. No Python packages or app installation are needed.
If Python 3 is unavailable, open index.html directly. Most editing and export tools work, but browsers may restrict local-file storage or offline/PWA features.

PRIVACY
Images are processed locally in your browser and are not uploaded to a TGRMLither server. Web fonts are fetched from Google Fonts when an internet connection is available; offline use falls back to fonts installed on your computer.

CONTENTS
- index.html: the complete application.
- manifest.webmanifest, icon.svg, sw.js: application metadata, icon and service-worker cache.
- Launch-TGRMLither.bat / Launch-TGRMLither.sh: local launchers.
- LICENSE: project license.

To stop the local server on Windows, close the minimized terminal window named "TGRMLither Local Server". On macOS/Linux, use Ctrl+C.
