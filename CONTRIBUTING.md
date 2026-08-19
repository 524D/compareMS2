# Contributing to compareMS2

Thanks for taking the time to contribute to compareMS2.

We welcome contributions that improve usability, fix bugs, add support for valid workflows, and clarify the project for users and developers.

## How to contribute

The preferred path is:

1. Open a GitHub issue to describe the problem, idea, or change.
2. Wait for feedback or approval from the maintainers.
3. Submit a pull request with the implementation.

This keeps the project organized and helps make sure new work matches the current direction of the software.

Small, clearly scoped fixes may go straight to a pull request without a prior issue. Examples include typo corrections, small documentation fixes, tiny bug fixes, or other minimal changes with a clear scope.

If you are unsure whether your idea is small enough to skip the issue step, open an issue first.

## Reporting issues

Before opening an issue, please check whether a similar report already exists.

When creating an issue, include:

- a clear title
- a short description of the problem or request
- the expected behavior
- the actual behavior, if applicable
- steps to reproduce
- relevant environment details, such as OS, version, and input data
- any screenshots, logs, or error messages that help explain the issue

For feature requests, explain the use case and why the change would be useful.

## Development workflow

For local development, follow the setup instructions in the README.

In short:

```bash
git clone https://github.com/524D/compareMS2.git
cd compareMS2
corepack enable
yarn
```

Then run the app in development mode with:

```bash
yarn start
```

## Pull requests

Pull requests are the standard way to contribute code.

Please make sure that your PR:

- is focused on a single change or bug fix
- includes a clear description of what changed and why
- references the related issue when applicable
- keeps the scope narrow and avoids unrelated edits
- follows the existing code style and project conventions

When a change affects behavior, please include enough detail in the PR description for reviewers to understand the intent and impact.

## Code and documentation standards

- Keep changes small and readable.
- Prefer clear, maintainable code over clever shortcuts.
- Update documentation when behavior, setup, or user workflows change.
- Include tests when practical and relevant.

## Questions

If you are not sure whether your contribution is appropriate, open an issue and ask before starting work. That helps avoid unnecessary effort and keeps the project easier to maintain.

Thank you for helping improve compareMS2.
