// party/server.ts  — Triangle Wars PartyKit Server
// Deploy: npx partykit deploy
import type * as Party from "partykit/server";

// ── Helpers ────────────────────────────────────────────────────────────────────
const ek = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = 0 | (Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function buildEdges(cols: number, rows: number): Set<string> {
  const s = new Set<string>();
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (c < cols - 1) s.add(ek(r * cols + c, r * cols + c + 1));
      if (r < rows - 1) s.add(ek(r * cols + c, (r + 1) * cols + c));
      if (c < cols - 1 && r < rows - 1) s.add(ek(r * cols + c, (r + 1) * cols + c + 1));
    }
  return s;
}

function completedTris(edge: string, drawn: string[], claimed: number[], cols: number, rows: number): number[] {
  const ds = new Set(drawn);
  const tris: [number, number, number][] = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const TL = r * cols + c, TR = TL + 1, BL = (r + 1) * cols + c, BR = BL + 1;
      tris.push([TL, TR, BR], [TL, BL, BR]);
    }
  const te = tris.map(([a, b, c]) => [ek(a, b), ek(b, c), ek(a, c)]);
  const et: Record<string, number[]> = {};
  te.forEach((es, ti) => es.forEach(e => (et[e] = et[e] || []).push(ti)));
  return (et[edge] || []).filter(ti => claimed[ti] === -1 && te[ti].every(e => e === edge || ds.has(e)));
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface Player { id: string; name: string; palIdx: number; connected: boolean; score: number; }
interface GS {
  phase: "lobby" | "playing" | "over";
  hostId: string;
  players: Player[];
  cols: number; rows: number;
  drawn: string[];
  claimed: number[];
  cur: number;
  max: number;
}

// ── Server ─────────────────────────────────────────────────────────────────────
export default class Server implements Party.Server {
  gs: GS | null = null;
  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    conn.send(JSON.stringify({ type: "hello", id: conn.id }));
    conn.send(JSON.stringify({ type: "state", s: this.gs }));
  }

  onMessage(raw: string, sender: Party.Connection) {
    const m = JSON.parse(raw);

    // ── Create room ──
    if (m.t === "create") {
      const { name, cols, rows, max } = m;
      this.gs = {
        phase: "lobby", hostId: sender.id,
        players: [{ id: sender.id, name: name || "Player 1", palIdx: 0, connected: true, score: 0 }],
        cols, rows, drawn: [],
        claimed: new Array((cols - 1) * (rows - 1) * 2).fill(-1),
        cur: 0, max,
      };
      this.bc(); return;
    }

    if (!this.gs) { sender.send(JSON.stringify({ type: "error", msg: "No room" })); return; }

    // ── Join room ──
    if (m.t === "join") {
      if (this.gs.phase !== "lobby") { sender.send(JSON.stringify({ type: "error", msg: "Game already started" })); return; }
      if (this.gs.players.length >= this.gs.max) { sender.send(JSON.stringify({ type: "error", msg: "Room is full" })); return; }
      const ex = this.gs.players.find(p => p.id === sender.id);
      if (ex) { ex.connected = true; }
      else this.gs.players.push({ id: sender.id, name: m.name || `Player ${this.gs.players.length + 1}`, palIdx: this.gs.players.length, connected: true, score: 0 });
      this.bc(); return;
    }

    // ── Start game ──
    if (m.t === "start") {
      if (sender.id !== this.gs.hostId || this.gs.players.length < 2) return;
      const idxs = shuffle([0, 1, 2].slice(0, this.gs.players.length));
      this.gs.players.forEach((p, i) => { p.palIdx = idxs[i]; });
      this.gs.phase = "playing";
      this.bc(); return;
    }

    // ── Make move ──
    if (m.t === "move") {
      if (this.gs.phase !== "playing") return;
      const cp = this.gs.players[this.gs.cur];
      if (cp.id !== sender.id) return;
      const { edge } = m;
      const allE = buildEdges(this.gs.cols, this.gs.rows);
      if (!allE.has(edge) || this.gs.drawn.includes(edge)) return;

      const hits = completedTris(edge, this.gs.drawn, this.gs.claimed, this.gs.cols, this.gs.rows);
      this.gs.drawn.push(edge);
      hits.forEach(ti => { this.gs!.claimed[ti] = this.gs!.cur; });
      this.gs.players[this.gs.cur].score += hits.length;

      const total = (this.gs.cols - 1) * (this.gs.rows - 1) * 2;
      if (this.gs.claimed.filter(c => c !== -1).length >= total || this.gs.drawn.length >= allE.size) {
        this.gs.phase = "over";
      } else if (hits.length === 0) {
        let next = (this.gs.cur + 1) % this.gs.players.length;
        let t = 0;
        while (!this.gs.players[next].connected && t++ < this.gs.players.length) next = (next + 1) % this.gs.players.length;
        this.gs.cur = next;
      }
      this.bc(); return;
    }

    // ── Quit / reset room ──
    if (m.t === "quit") {
      this.gs = null;
      this.room.broadcast(JSON.stringify({ type: "reset" })); return;
    }
  }

  onClose(conn: Party.Connection) {
    if (!this.gs) return;
    const p = this.gs.players.find(x => x.id === conn.id);
    if (!p) return;
    p.connected = false;
    // Auto-advance turn if current player disconnected
    if (this.gs.phase === "playing" && this.gs.players[this.gs.cur].id === conn.id) {
      let next = (this.gs.cur + 1) % this.gs.players.length;
      let t = 0;
      while (!this.gs.players[next].connected && t++ < this.gs.players.length) next = (next + 1) % this.gs.players.length;
      this.gs.cur = next;
    }
    this.bc();
  }

  bc() { this.room.broadcast(JSON.stringify({ type: "state", s: this.gs })); }
}
