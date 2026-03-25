# Contributing to @stackbilt/feature-flags

Thanks for your interest in contributing! This project is part of the [Stackbilt](https://stackbilt.dev) ecosystem.

## Development Setup

```bash
git clone https://github.com/Stackbilt-dev/feature-flags.git
cd feature-flags
npm install
npm run typecheck
npm test
```

## Pull Requests

1. Fork the repo and create your branch from `main`.
2. Add tests for any new functionality.
3. Ensure `npm run typecheck` and `npm test` pass.
4. Keep PRs focused — one feature or fix per PR.

## Code Style

- TypeScript strict mode
- No `any` types in public APIs (internal usage is acceptable)
- Export types alongside implementations

## Reporting Issues

Open an issue on [GitHub](https://github.com/Stackbilt-dev/feature-flags/issues) with:
- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
