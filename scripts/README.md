# Utility Scripts

- `verify_google_live.py`: optional real-provider smoke check for developers.
  It connects to the locally running backend and makes a real provider request;
  use `--base-url` when the backend is running on a non-default local port.
  `--exercise-resumption` verifies that a provider-issued handle can reopen the
  same Live session without starting an interview turn.
  it is not part of `npm run verify` and should remain unused while API access is
  intentionally disabled.

Normal users should not run anything in this directory. Use the root
`Start AI Interview Simulator.command` launcher.
