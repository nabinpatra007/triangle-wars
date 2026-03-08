// party/server.ts  — Triangle Wars PartyKit Server (Strategic Diagonal Mode)
// Deploy: npx partykit deploy
import type * as Party from "partykit/server";

// ── Helpers ───────────────────────────────────────────────────────────────────
const ek = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = 0|(Math.random()*(i+1)); [b[i],b[j]]=[b[j],b[i]]; }
  return b;
}

// ── Strategic mode helpers ────────────────────────────────────────────────────

// Which cell + direction a diagonal belongs to (null if H/V)
function getDiagInfo(edge: string, cols: number): { cellR: number; cellC: number; dir: "TLBR"|"TRBL" } | null {
  const [a, b] = edge.split("|").map(Number);
  const rA = Math.floor(a/cols), cA = a%cols, rB = Math.floor(b/cols), cB = b%cols;
  if (rA === rB || cA === cB) return null;
  const dir = cA < cB ? "TLBR" : "TRBL";
  return { cellR: rA, cellC: cA < cB ? cA : cB, dir };
}

// Build cellDiags from drawn array
function deriveCellDiags(drawn: string[], cols: number): Record<string, "TLBR"|"TRBL"> {
  const cd: Record<string, "TLBR"|"TRBL"> = {};
  for (const e of drawn) { const i = getDiagInfo(e, cols); if (i) cd[`${i.cellR}_${i.cellC}`] = i.dir; }
  return cd;
}

// 3 edges of each triangle in a cell
function getCellTriEdges(r: number, c: number, dir: "TLBR"|"TRBL", cols: number): [string,string,string][] {
  const TL=r*cols+c, TR=r*cols+c+1, BL=(r+1)*cols+c, BR=(r+1)*cols+c+1;
  if (dir==="TLBR") { const d=ek(TL,BR); return [[ek(TL,TR),ek(TR,BR),d],[ek(TL,BL),ek(BL,BR),d]]; }
  else              { const d=ek(TR,BL); return [[ek(TL,TR),ek(TL,BL),d],[ek(TR,BR),ek(BL,BR),d]]; }
}

// Are two dots directly adjacent?
function isAdjacentEdge(a: number, b: number, cols: number): boolean {
  const dr=Math.abs(Math.floor(a/cols)-Math.floor(b/cols)), dc=Math.abs(a%cols-b%cols);
  return (dr===0&&dc===1)||(dr===1&&dc===0)||(dr===1&&dc===1);
}

// All currently valid edges (H + V always; diagonals only if cell not locked to other direction)
function getValidEdges(drawn: string[], cellDiags: Record<string,string>, cols: number, rows: number): string[] {
  const ds=new Set(drawn); const v: string[]=[];
  for (let r=0;r<rows;r++) for (let c=0;c<cols-1;c++) { const e=ek(r*cols+c,r*cols+c+1); if(!ds.has(e)) v.push(e); }
  for (let r=0;r<rows-1;r++) for (let c=0;c<cols;c++) { const e=ek(r*cols+c,(r+1)*cols+c); if(!ds.has(e)) v.push(e); }
  for (let r=0;r<rows-1;r++) for (let c=0;c<cols-1;c++) {
    const TL=r*cols+c,TR=r*cols+c+1,BL=(r+1)*cols+c,BR=(r+1)*cols+c+1;
    const lk=cellDiags[`${r}_${c}`];
    const tlbr=ek(TL,BR); if(!ds.has(tlbr)&&(!lk||lk==="TLBR")) v.push(tlbr);
    const trbl=ek(TR,BL); if(!ds.has(trbl)&&(!lk||lk==="TRBL")) v.push(trbl);
  }
  return v;
}

// Find triangles completed by drawing `edge` (given updated cellDiags including new diagonal)
function completedTris(
  edge: string,
  drawn: string[],
  cellDiags: Record<string,"TLBR"|"TRBL">,
  claimed: Record<string,number>,
  cols: number
): string[] {
  const nd = new Set(drawn); nd.add(edge);
  const dInfo = getDiagInfo(edge, cols);
  const [a,b] = edge.split("|").map(Number);
  const rA=Math.floor(a/cols),cA=a%cols,rB=Math.floor(b/cols),cB=b%cols;
  const cands = new Set<string>();
  if (dInfo) { cands.add(`${dInfo.cellR}_${dInfo.cellC}`); }
  else if (rA===rB) { const mc=Math.min(cA,cB); if(rA>0) cands.add(`${rA-1}_${mc}`); cands.add(`${rA}_${mc}`); }
  else              { const mr=Math.min(rA,rB); if(cA>0) cands.add(`${mr}_${cA-1}`); cands.add(`${mr}_${cA}`); }
  const hits: string[] = [];
  for (const ck of cands) {
    const dir = cellDiags[ck]; if (!dir) continue;
    const [cr,cc] = ck.split("_").map(Number);
    getCellTriEdges(cr,cc,dir,cols).forEach((edges,ti) => {
      const claimKey = `${cr}_${cc}_${ti}`;
      if (claimed[claimKey] === undefined && edges.every(e => nd.has(e))) hits.push(claimKey);
    });
  }
  return hits;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Player { id: string; name: string; palIdx: number; connected: boolean; score: number; }
interface GS {
  phase: "lobby"|"playing"|"over";
  hostId: string;
  players: Player[];
  cols: number; rows: number;
  drawn: string[];
  claimed: Record<string, number>;  // "r_c_triIdx" → playerIdx
  cur: number;
  max: number;
}

// ── Server ────────────────────────────────────────────────────────────────────
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
        players: [{ id: sender.id, name: name||"Player 1", palIdx: 0, connected: true, score: 0 }],
        cols, rows, drawn: [], claimed: {}, cur: 0, max,
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
      else this.gs.players.push({ id: sender.id, name: m.name||`Player ${this.gs.players.length+1}`, palIdx: this.gs.players.length, connected: true, score: 0 });
      this.bc(); return;
    }

    // ── Start game ──
    if (m.t === "start") {
      if (sender.id !== this.gs.hostId || this.gs.players.length < 2) return;
      const idxs = shuffle([0,1,2].slice(0, this.gs.players.length));
      this.gs.players.forEach((p,i) => { p.palIdx = idxs[i]; });
      this.gs.phase = "playing";
      this.bc(); return;
    }

    // ── Make move ──
    if (m.t === "move") {
      if (this.gs.phase !== "playing") return;
      const cp = this.gs.players[this.gs.cur];
      if (cp.id !== sender.id) return;
      const { edge } = m;

      // Validate adjacency
      const [a, b] = edge.split("|").map(Number);
      if (!isAdjacentEdge(a, b, this.gs.cols)) return;

      // Validate not already drawn
      if (this.gs.drawn.includes(edge)) return;

      // Validate diagonal conflict
      const dInfo = getDiagInfo(edge, this.gs.cols);
      const cellDiags = deriveCellDiags(this.gs.drawn, this.gs.cols);
      if (dInfo) {
        const ck = `${dInfo.cellR}_${dInfo.cellC}`;
        if (cellDiags[ck] && cellDiags[ck] !== dInfo.dir) return;
        // Lock this cell's diagonal direction
        cellDiags[ck] = dInfo.dir;
      }

      // Find completed triangles
      const hits = completedTris(edge, this.gs.drawn, cellDiags, this.gs.claimed, this.gs.cols);

      // Apply move
      this.gs.drawn.push(edge);
      hits.forEach(k => { this.gs!.claimed[k] = this.gs!.cur; });
      this.gs.players[this.gs.cur].score += hits.length;

      // Check game over — no valid edges remain
      const updatedCellDiags = deriveCellDiags(this.gs.drawn, this.gs.cols);
      const valid = getValidEdges(this.gs.drawn, updatedCellDiags, this.gs.cols, this.gs.rows);
      if (valid.length === 0) {
        this.gs.phase = "over";
      } else if (hits.length === 0) {
        // No score — advance to next connected player
        let next = (this.gs.cur + 1) % this.gs.players.length;
        let t = 0;
        while (!this.gs.players[next].connected && t++ < this.gs.players.length)
          next = (next + 1) % this.gs.players.length;
        this.gs.cur = next;
      }
      this.bc(); return;
    }

    // ── Quit / reset ──
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
    if (this.gs.phase === "playing" && this.gs.players[this.gs.cur].id === conn.id) {
      let next = (this.gs.cur + 1) % this.gs.players.length;
      let t = 0;
      while (!this.gs.players[next].connected && t++ < this.gs.players.length)
        next = (next + 1) % this.gs.players.length;
      this.gs.cur = next;
    }
    this.bc();
  }

  bc() { this.room.broadcast(JSON.stringify({ type: "state", s: this.gs })); }
}
