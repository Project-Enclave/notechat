# NoteChat TUI

An offline-first terminal UI for [notes.projectenclave.dev](https://notes.projectenclave.dev).

Works even if Vercel or Supabase is down — reads from a local SQLite cache and queues writes for later sync.

## Setup

```bash
pip install textual aiosqlite httpx
```

## Run

```bash
export NOTECHAT_URL=https://notes.projectenclave.dev
export NOTECHAT_USER=yourname
python tui/notechat_tui.py
```

## Keybindings

| Key | Action |
|-----|--------|
| `n` | New note |
| `s` | Save & sync note |
| `r` | Refresh from server |
| `Ctrl+S` | Flush offline queue |
| `Enter` | Send chat message |
| `q` | Quit |

## How it works

- **Notes tab** — lists all notes from the API; click to open in editor.
- **Chat tab** — shows the last 100 messages; type and press Enter to send.
- **Offline** — if either server is down, it falls back to local SQLite cache and queues any writes to an outbox. Run `Ctrl+S` when back online to flush the queue.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NOTECHAT_URL` | `https://notes.projectenclave.dev` | Base URL of the app |
| `NOTECHAT_USER` | `tui-user` | Username for chat messages |
| `NOTECHAT_DB` | `~/.notechat_cache.db` | Path to local SQLite cache |
