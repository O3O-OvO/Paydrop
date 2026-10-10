# Experience Refinement - 2026-10-10

## Scope

Implemented the six priorities from the user-experience audit:

1. New users confirm daily salary, working hours, rest, weekdays, calendar policy and tracking mode before entering the dashboard. Existing configured users retain their setup and records.
2. The dashboard uses a compact header so income, countdown and work-duration metrics fit above the fold at 1280 x 720.
3. Unfinished historical shifts show an explicit date and review action instead of appearing to be today's earnings. Normal overnight shifts are not flagged before their scheduled end. No historical shift is automatically ended.
4. Dashboard and widget show the current rest's elapsed time, including temporary and scheduled rest. Compact widgets prioritize the rest timer while resting.
5. Progress is labeled as planned-shift progress, not income progress. Rest days and overtime omit the misleading progress bar.
6. Appearance settings include a live widget preview. Theme changes remain drafts until saved. Preview data is in-memory and only appearance fields are sent to the frame.

## Compatibility and Safety

- Existing salary calculations and frozen shift snapshots are preserved.
- Legacy configured settings bypass new-user onboarding.
- Preview does not initialize persistent storage or subscribe to desktop update events.
- HTTP preview messages require the same origin and parent source. Electron file pages accept the opaque message origin only from their parent.
- Tests use isolated browser contexts and separate Electron profiles.
- No version bump, package, commit or release was made for this iteration.

## Verification

- 139 unit tests passed, including 12 new experience-focused cases.
- Vite production build passed.
- Browser workflows cover onboarding, rest/resume, ending a test shift, navigation, preview cancellation and save.
- Layout checks cover three themes at 1280, 1600, 768, 390 and 320 pixels, plus mobile appearance preview.
- Historical-record safety and absence of browser page errors checked.
- Native Electron checks passed for onboarding, file-origin preview isolation, IPC save and restart persistence.
- Existing native regression passed for record review/correction, preserving unsaved drafts, widget resizing and calendar synchronization.

## Limits

- Native tests exercised the production build in Electron, not a newly packaged installer.
- Web screenshots provide visual evidence; hidden native-window screenshot capture timed out, so native validation is based on interaction and state assertions.
- Cross-window conflicting appearance drafts were not independently stress-tested in this iteration.

## Preview

With the local development server running:

- Dashboard: http://localhost:5173/
- Widget: http://localhost:5173/widget.html
