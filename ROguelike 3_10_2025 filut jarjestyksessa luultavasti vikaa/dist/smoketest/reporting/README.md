# smoketest/reporting

Rendering and export of results.

Files
- render.js — pure renderers:
  - renderHeader(meta)
  - renderMainReport(parts)
  - renderStepsPretty(list)
  - buildKeyChecklistHtmlFromSteps(steps)
- export.js — attachButtons(report, summaryText, checklistText); wires JSON/TXT downloads via Blob URLs and handles cleanup.

Notes
- Loaded before runner; the orchestrator and legacy runner delegate report building and export to these modules.