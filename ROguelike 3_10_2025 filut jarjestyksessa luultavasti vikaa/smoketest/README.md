# Smoketest

This folder contains a minimal, dependency-free smoke test for the project. It verifies that the static dev server can start and that key client assets are served.

Usage:
1) Ensure you have Node.js installed.
2) From the project root, run:
   node smoketest/smoke.js

What it does:
- Starts the local static server (server.js) in a child process.
- Waits until the server is listening.
- Requests index.html with ?smoketest=1 to ensure the client smoke runner is injected.
- Checks that critical files respond with HTTP 200:
  - index.html
  - ui/ui.js
  - core/game.js
  - ui/smoketest_runner.js
- Verifies index.html contains expected markers (canvas#game and GOD panel controls).
- Prints a summary and exits with non-zero status if any checks fail.

No external dependencies are required. The test uses only built-in Node modules.