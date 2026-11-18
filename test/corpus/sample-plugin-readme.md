# Lantern

A small plugin that keeps a running log of what each [agent](https://example.com/agents) did in a
thread, so you can skim a long session in a minute.

![The Lantern panel with three log entries](docs/lantern.png)

<!-- demo video goes here -->

<img width="640" alt="Lantern in dark mode" src="https://example.com/lantern-dark.png" />

## What it does

- **A log panel per thread.** Open it from the thread's panel menu. Entries appear as the
  agent works, grouped by turn, and stay after the thread finishes.
- **Search.** Filter entries by tool, file or text. The filter is kept per thread and
  survives a reload.
- **Export.** Copy the log as Markdown, or save it next to the repo as `LANTERN_LOG.md`.

See [CONTRIBUTING_GUIDE.md](CONTRIBUTING_GUIDE.md) before opening a pull request.

## Install

1. Clone the repository:

   ```bash
   git clone https://example.com/lantern.git
   ```

2. Install it into bb:

   ```bash
   bb plugin install ./lantern
   ```

3. Open any thread and choose **Lantern** from the panel menu.

## Settings

| Setting | Default | What it changes |
| --- | --- | --- |
| `maxEntries` | `500` | Older entries are dropped past this count. |
| `showTimestamps` | `true` | Shows the time beside each entry. |

## License

MIT
