# Changelog

All notable changes to this project are documented in this file.

## [1.4.0] - 2026-11-02

### Added

- Search across all threads, with filters for date and author.
- `--json` output for the `export` command.

### Changed

- **Breaking:** the `limit` option is now `max_results`.
- Faster startup on large projects (about 40% in our tests).

### Fixed

- A crash when a file name contained a `#`.

## [1.3.2] - 2026-10-15

### Fixed

- Exports no longer drop the last line when the file has no trailing newline.
