# PROJECT RULES

## Product Philosophy

-   Build immersion, not a chatbot.
-   Director Engine owns the interview.
-   AI executes the interview.
-   Every feature must improve realism.

## Engineering Rules

-   One milestone at a time.
-   No future features.
-   Explain every architectural decision.
-   Keep modules independent.
-   Prefer readability over cleverness.

## Before every task

1. Read `README.md` and only the docs relevant to the task.
2. Preserve the single local runtime: frontend `3001`, backend `8000`.
3. Implement only the requested milestone.
4. Run tests in proportion to the change.
5. Update documentation when behavior or startup changes.

## Runtime rules

- Use `.venv/bin/python`; do not depend on a globally installed Python tool.
- Voice model selection happens in Setup and is locked during an interview.
- The Director session is the source of truth for Start, End, and question state.
- Future modules must be labeled as future; do not document them as active.
