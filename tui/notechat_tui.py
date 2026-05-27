# notechat_tui.py — offline-first TUI for Project-Enclave/notechat
# Mirrors notes.projectenclave.dev with local SQLite cache.
# Works even if Vercel or Supabase is down.
#
# Setup:
#   pip install textual aiosqlite httpx
#   python notechat_tui.py
#
# Set your base URL:
#   export NOTECHAT_URL=https://notes.projectenclave.dev
#   export NOTECHAT_USER=yourname   (used as chat username)

import aiosqlite
import asyncio
import datetime
import os
from pathlib import Path

import httpx
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import (
    Footer,
    Header,
    Input,
    Label,
    ListItem,
    ListView,
    Static,
    TextArea,
    TabbedContent,
    TabPane,
)
from textual import work

BASE_URL = os.environ.get("NOTECHAT_URL", "https://notes.projectenclave.dev").rstrip("/")
USERNAME = os.environ.get("NOTECHAT_USER", "tui-user")
DB = Path(os.environ.get("NOTECHAT_DB", str(Path.home() / ".notechat_cache.db")))


# ---------------------------------------------------------------------------
# Local SQLite cache
# ---------------------------------------------------------------------------

def init_db():
    import sqlite3
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        author TEXT,
        updated_at TEXT,
        synced INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    """)
    conn.commit()
    conn.close()


async def cache_notes(notes: list):
    async with aiosqlite.connect(DB) as db:
        for n in notes:
            await db.execute(
                "INSERT OR REPLACE INTO notes(id,title,content,author,updated_at,synced) VALUES(?,?,?,?,?,1)",
                (str(n["id"]), n.get("title",""), n.get("content",""), n.get("author"), n.get("updated_at")),
            )
        await db.commit()


async def cached_notes() -> list:
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM notes ORDER BY updated_at DESC") as c:
            return [dict(r) async for r in c]


async def cache_messages(msgs: list):
    async with aiosqlite.connect(DB) as db:
        for m in msgs:
            await db.execute(
                "INSERT OR REPLACE INTO messages(id,username,content,created_at) VALUES(?,?,?,?)",
                (str(m["id"]), m.get("username",""), m.get("content",""), m.get("created_at")),
            )
        await db.commit()


async def cached_messages() -> list:
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM messages ORDER BY created_at ASC") as c:
            return [dict(r) async for r in c]


async def enqueue(kind: str, payload: dict):
    import json
    now = datetime.datetime.now().isoformat()
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "INSERT INTO outbox(kind,payload,created_at) VALUES(?,?,?)",
            (kind, json.dumps(payload), now),
        )
        await db.commit()


async def flush_outbox():
    import json
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM outbox ORDER BY id ASC") as c:
            items = [dict(r) async for r in c]
    for item in items:
        payload = json.loads(item["payload"])
        ok = False
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                if item["kind"] == "note":
                    r = await client.post(f"{BASE_URL}/api/notes", json=payload)
                    ok = r.status_code in (200, 201)
                elif item["kind"] == "message":
                    r = await client.post(f"{BASE_URL}/api/messages", json=payload)
                    ok = r.status_code in (200, 201)
        except Exception:
            pass
        if ok:
            async with aiosqlite.connect(DB) as db:
                await db.execute("DELETE FROM outbox WHERE id=?", (item["id"],))
                await db.commit()


# ---------------------------------------------------------------------------
# API helpers (fall back to cache on failure)
# ---------------------------------------------------------------------------

async def fetch_notes() -> tuple[list, bool]:
    """Returns (notes, from_cache)."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{BASE_URL}/api/notes")
            r.raise_for_status()
            notes = r.json()
            await cache_notes(notes)
            return notes, False
    except Exception:
        return await cached_notes(), True


async def fetch_messages() -> tuple[list, bool]:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{BASE_URL}/api/messages")
            r.raise_for_status()
            msgs = r.json()
            await cache_messages(msgs)
            return msgs, False
    except Exception:
        return await cached_messages(), True


async def post_note(title: str, content: str) -> bool:
    payload = {"title": title, "content": content}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(f"{BASE_URL}/api/notes", json=payload)
            if r.status_code in (200, 201):
                return True
    except Exception:
        pass
    await enqueue("note", payload)
    return False


async def post_message(content: str) -> bool:
    payload = {"username": USERNAME, "content": content}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(f"{BASE_URL}/api/messages", json=payload)
            if r.status_code in (200, 201):
                return True
    except Exception:
        pass
    await enqueue("message", payload)
    return False


# ---------------------------------------------------------------------------
# Widgets
# ---------------------------------------------------------------------------

class NotesList(ListView):
    def compose(self) -> ComposeResult:
        yield from []

    @work(exclusive=True)
    async def load(self):
        notes, from_cache = await fetch_notes()
        self.clear()
        for n in notes:
            label = f"{'[dim]' if from_cache else ''}{n.get('title') or '(untitled)'}{'[/dim]' if from_cache else ''}"
            item = ListItem(Static(label))
            item.note = n
            self.append(item)
        if from_cache:
            self.app.notify("Offline — showing cached notes", severity="warning")


class NoteEditor(Container):
    current_note = None

    def compose(self) -> ComposeResult:
        yield Input(placeholder="Title", id="note-title")
        yield TextArea(id="note-body", language="markdown")

    def load(self, note):
        self.current_note = note
        self.query_one("#note-title", Input).value = note.get("title", "")
        self.query_one("#note-body", TextArea).text = note.get("content", "")

    def clear(self):
        self.current_note = None
        self.query_one("#note-title", Input).value = ""
        self.query_one("#note-body", TextArea).text = ""


class ChatView(Container):
    def compose(self) -> ComposeResult:
        yield TextArea(id="chat-log", read_only=True)
        yield Input(placeholder=f"Message as {USERNAME}...", id="chat-input")

    @work(exclusive=True)
    async def load(self):
        msgs, from_cache = await fetch_messages()
        lines = [f"{m['username']}: {m['content']}" for m in msgs]
        self.query_one("#chat-log", TextArea).text = "\n".join(lines)
        if from_cache:
            self.app.notify("Offline — showing cached messages", severity="warning")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

class NoteChatTUI(App):
    """Offline-first TUI for notes.projectenclave.dev"""

    CSS = """
    TabbedContent { height: 1fr; }
    Horizontal { height: 1fr; }
    #notes-list { width: 30%; height: 1fr; border: solid $primary; }
    NoteEditor { width: 70%; height: 1fr; }
    #note-title { height: 3; }
    #note-body { height: 1fr; }
    ChatView { width: 1fr; height: 1fr; }
    #chat-log { height: 1fr; }
    #chat-input { height: 3; }
    """

    BINDINGS = [
        Binding("n", "new_note", "New Note"),
        Binding("s", "save_note", "Save Note"),
        Binding("r", "refresh", "Refresh"),
        Binding("enter", "send_message", "Send", show=False),
        Binding("ctrl+s", "sync", "Sync"),
        Binding("q", "quit", "Quit"),
    ]

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with TabbedContent():
            with TabPane("Notes", id="tab-notes"):
                with Horizontal():
                    yield NotesList(id="notes-list")
                    yield NoteEditor(id="note-editor")
            with TabPane("Chat", id="tab-chat"):
                yield ChatView(id="chat-view")
        yield Footer()

    def on_mount(self):
        init_db()
        self.query_one(NotesList).load()
        self.query_one(ChatView).load()

    def on_list_view_highlighted(self, event: ListView.Highlighted):
        item = event.item
        if item and hasattr(item, "note"):
            self.query_one(NoteEditor).load(item.note)

    def action_new_note(self):
        self.query_one(NoteEditor).clear()
        self.query_one("#note-title", Input).focus()

    @work(exclusive=True)
    async def action_save_note(self):
        editor = self.query_one(NoteEditor)
        title = self.query_one("#note-title", Input).value.strip()
        content = self.query_one("#note-body", TextArea).text
        if not title:
            self.notify("Title required", severity="warning")
            return
        sent = await post_note(title, content)
        self.notify("Saved & synced" if sent else "Saved locally (queued for sync)")
        self.query_one(NotesList).load()

    @work(exclusive=True)
    async def action_send_message(self):
        inp = self.query_one("#chat-input", Input)
        content = inp.value.strip()
        if not content:
            return
        inp.value = ""
        sent = await post_message(content)
        self.notify("Sent" if sent else "Queued (offline)")
        self.query_one(ChatView).load()

    @work(exclusive=True)
    async def action_refresh(self):
        self.query_one(NotesList).load()
        self.query_one(ChatView).load()
        self.notify("Refreshed")

    @work(exclusive=True)
    async def action_sync(self):
        await flush_outbox()
        self.notify("Outbox flushed")
        self.query_one(NotesList).load()
        self.query_one(ChatView).load()


if __name__ == "__main__":
    NoteChatTUI().run()
