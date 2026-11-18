# Getting started

This guide takes about five minutes.

## Before you begin

- bb 0.49 or later
- A project with at least one thread

## Steps

1. Open a thread and ask the agent:

   > Summarize this week's changes to the billing service, with a table of the riskiest ones.

2. The agent reads the repository, writes the summary, and saves it as `docs/weekly.md`. If the
   save check finds a problem, the agent fixes it and saves again.
3. The reply shows a card with the summary's title and an "Open in side panel" button.

## Next steps

- Read the [reference](reference.md) for every setting.
- Try asking for a chart: *"plot deploys per day for the last two weeks"*.
