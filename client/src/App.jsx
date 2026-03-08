import { useState, useEffect, useRef, useMemo } from "react";

const PARTYKIT_HOST = "triangle-wars.nabinpatra007.partykit.dev";

// ── Viewport fix ───────────────────────────────────────────────────
;(function () {
  let m = document.querySelector('meta[name="viewport"]');
  if (!m) { m = document.createElement("meta"); m.name = "viewport"; document.head.appendChild(m); }
  m.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1");
  const s = document.createElement("style");
  s.textContent = "*, *::before, *::after { box-sizing: border-box; } body, #root { margin: 0; padding: 0; width: 100%; min-height: 100vh; }";
  document.head.appendChild(s);
})();

const PALETTE = [
  { name: "Ruby",  color: "#FF4D6D", fill: "#FF4D6D38" },
  { name: "Cyan",  color: "#00D4FF", fill: "#00D4FF38" },
  { name: "Amber", color: "#FFAA33", fill: "#FFAA3338" },
];
const GRID_PRESETS = [
  { key: "small",  cols: 5, rows: 6, label: "Small",  sub: "40 △ · Quick"   },
  { key: "medium", cols: 6, rows: 7, label: "Medium", sub: "60 △ · Default" },
  { key: "large",  cols: 7, rows: 9, label: "Large",  sub: "96 △ · Epic"    },
];
const PAD = 28, DOT_R = 5;
const eKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const shuffle = a => { const b = [...a]; for (let i = b.length-1; i > 0; i--) { const j = 0|Math.random()*(i+1); [b[i],b[j]]=[b[j],b[i]]; } return b; };
const genCode = () => Math.random().toString(36).slice(2,6).toUpperCase();

// ══════════════════════════════════════════════════════════════════
// STRATEGIC MODE — diagonals drawn by players
// First diagonal drawn in a cell locks its direction for that cell.
// Triangles only exist once a cell has a diagonal.
// ══════════════════════════════════════════════════════════════════

// Which cell + direction a diagonal edge belongs to (null if H/V)
function getDiagInfo(ek, cols) {
  const [a, b] = ek.split("|").map(Number);
  const rA = Math.floor(a/cols), cA = a%cols;
  const rB = Math.floor(b/cols), cB = b%cols;
  if (rA === rB || cA === cB) return null;
  const dir = cA < cB ? "TLBR" : "TRBL";
  return { cellR: rA, cellC: cA < cB ? cA : cB, dir };
}

// Build cellDiags map from drawn set (no need to store separately)
function deriveCellDiags(drawn, cols) {
  const cd = {};
  for (const ek of drawn) { const i = getDiagInfo(ek, cols); if (i) cd[`${i.cellR}_${i.cellC}`] = i.dir; }
  return cd;
}

// 3 edges of each of the 2 triangles in a cell, given its diagonal direction
// TLBR(↘): tri0=TL-TR-BR, tri1=TL-BL-BR
// TRBL(↙): tri0=TL-TR-BL, tri1=TR-BR-BL
function getCellTriEdges(r, c, dir, cols) {
  const TL=r*cols+c, TR=r*cols+c+1, BL=(r+1)*cols+c, BR=(r+1)*cols+c+1;
  if (dir === "TLBR") { const d=eKey(TL,BR); return [[eKey(TL,TR),eKey(TR,BR),d],[eKey(TL,BL),eKey(BL,BR),d]]; }
  else                { const d=eKey(TR,BL); return [[eKey(TL,TR),eKey(TL,BL),d],[eKey(TR,BR),eKey(BL,BR),d]]; }
}

// Canvas vertex positions for a triangle
function getTriVerts(cr, cc, dir, triIdx, cs) {
  const TLx=PAD+cc*cs, TLy=PAD+cr*cs, TRx=PAD+(cc+1)*cs, TRy=TLy;
  const BLx=TLx, BLy=PAD+(cr+1)*cs, BRx=TRx, BRy=BLy;
  if (dir==="TLBR") return triIdx===0?[{x:TLx,y:TLy},{x:TRx,y:TRy},{x:BRx,y:BRy}]:[{x:TLx,y:TLy},{x:BLx,y:BLy},{x:BRx,y:BRy}];
  else              return triIdx===0?[{x:TLx,y:TLy},{x:TRx,y:TRy},{x:BLx,y:BLy}]:[{x:TRx,y:TRy},{x:BRx,y:BRy},{x:BLx,y:BLy}];
}

// Are two dots directly adjacent? (H, V, or same-cell diagonal)
function isAdjacentEdge(a, b, cols) {
  const dr=Math.abs(Math.floor(a/cols)-Math.floor(b/cols)), dc=Math.abs(a%cols-b%cols);
  return (dr===0&&dc===1)||(dr===1&&dc===0)||(dr===1&&dc===1);
}

// All edges currently drawable (H + V always, diagonals only if cell not locked to other direction)
function getValidEdges(drawn, cellDiags, cols, rows) {
  const v=[];
  for (let r=0;r<rows;r++) for (let c=0;c<cols-1;c++) { const e=eKey(r*cols+c,r*cols+c+1); if(!drawn.has(e)) v.push(e); }
  for (let r=0;r<rows-1;r++) for (let c=0;c<cols;c++) { const e=eKey(r*cols+c,(r+1)*cols+c); if(!drawn.has(e)) v.push(e); }
  for (let r=0;r<rows-1;r++) for (let c=0;c<cols-1;c++) {
    const TL=r*cols+c,TR=r*cols+c+1,BL=(r+1)*cols+c,BR=(r+1)*cols+c+1;
    const lk=cellDiags[`${r}_${c}`];
    const tlbr=eKey(TL,BR); if(!drawn.has(tlbr)&&(!lk||lk==="TLBR")) v.push(tlbr);
    const trbl=eKey(TR,BL); if(!drawn.has(trbl)&&(!lk||lk==="TRBL")) v.push(trbl);
  }
  return v;
}

// ══════════════════════════════════════════════════════════════════
// GRID BUILDER — only static H+V edges; diagonals are player-drawn
// ══════════════════════════════════════════════════════════════════
function buildGrid(cols, rows) {
  const allEdges=new Set();
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
    if(c<cols-1) allEdges.add(eKey(r*cols+c,r*cols+c+1));
    if(r<rows-1) allEdges.add(eKey(r*cols+c,(r+1)*cols+c));
  }
  return { allEdges };
}

// ══════════════════════════════════════════════════════════════════
// GAME LOGIC  — claimed: Record<"r_c_triIdx", playerIdx>
// ══════════════════════════════════════════════════════════════════
function completedBy(ek, drawn, cellDiags, cols) {
  const nd=new Set(drawn); nd.add(ek);
  const dInfo=getDiagInfo(ek,cols);
  const tempCD={...cellDiags};
  if(dInfo) tempCD[`${dInfo.cellR}_${dInfo.cellC}`]=dInfo.dir;
  const hits=[];
  const [a,b]=ek.split("|").map(Number);
  const rA=Math.floor(a/cols),cA=a%cols,rB=Math.floor(b/cols),cB=b%cols;
  const cands=new Set();
  if(dInfo) { cands.add(`${dInfo.cellR}_${dInfo.cellC}`); }
  else if(rA===rB) { const mc=Math.min(cA,cB); if(rA>0) cands.add(`${rA-1}_${mc}`); cands.add(`${rA}_${mc}`); }
  else             { const mr=Math.min(rA,rB); if(cA>0) cands.add(`${mr}_${cA-1}`); cands.add(`${mr}_${cA}`); }
  for (const ck of cands) {
    const dir=tempCD[ck]; if(!dir) continue;
    const [cr,cc]=ck.split("_").map(Number);
    getCellTriEdges(cr,cc,dir,cols).forEach((edges,ti) => { if(edges.every(e=>nd.has(e))) hits.push(`${cr}_${cc}_${ti}`); });
  }
  return hits;
}

function applyMove(ek, drawn, claimed, cellDiags, scores, pIdx, cols, rows) {
  if(drawn.has(ek)) return null;
  const dInfo=getDiagInfo(ek,cols);
  if(dInfo) { const ck=`${dInfo.cellR}_${dInfo.cellC}`; if(cellDiags[ck]&&cellDiags[ck]!==dInfo.dir) return null; }
  const nd=new Set(drawn); nd.add(ek);
  const ncd={...cellDiags}; if(dInfo) ncd[`${dInfo.cellR}_${dInfo.cellC}`]=dInfo.dir;
  const hitKeys=completedBy(ek,drawn,ncd,cols).filter(k=>claimed[k]===undefined);
  const nc={...claimed}; hitKeys.forEach(k=>{nc[k]=pIdx;});
  const ns=[...scores]; if(hitKeys.length) ns[pIdx]+=hitKeys.length;
  const done=getValidEdges(nd,ncd,cols,rows).length===0;
  return { nextDrawn:nd, nextClaimed:nc, nextCellDiags:ncd, nextScores:ns, scored:hitKeys.length>0, hitKeys, done };
}

function aiPick(drawn, claimed, cellDiags, cols, rows) {
  const avail=getValidEdges(drawn,cellDiags,cols,rows);
  if(!avail.length) return null;
  let best=0, bestEk=null;
  for (const ek of avail) {
    const di=getDiagInfo(ek,cols);
    const tcd=di?{...cellDiags,[`${di.cellR}_${di.cellC}`]:di.dir}:cellDiags;
    const n=completedBy(ek,drawn,tcd,cols).filter(k=>claimed[k]===undefined).length;
    if(n>best){best=n;bestEk=ek;}
  }
  if(bestEk) return bestEk;
  let minG=Infinity, pool=[];
  for (const ek of avail) {
    const di=getDiagInfo(ek,cols);
    const nd=new Set(drawn); nd.add(ek);
    const tcd=di?{...cellDiags,[`${di.cellR}_${di.cellC}`]:di.dir}:cellDiags;
    let g=0;
    for (const e2 of getValidEdges(nd,tcd,cols,rows)) {
      const d2=getDiagInfo(e2,cols);
      const tcd2=d2?{...tcd,[`${d2.cellR}_${d2.cellC}`]:d2.dir}:tcd;
      g+=completedBy(e2,nd,tcd2,cols).filter(k=>claimed[k]===undefined).length;
    }
    if(g<minG){minG=g;pool=[ek];}else if(g===minG) pool.push(ek);
  }
  return pool[0|Math.random()*pool.length];
}

// ══════════════════════════════════════════════════════════════════
// HOOK: responsive cell size
// ══════════════════════════════════════════════════════════════════
function useCellSize(cols, rows) {
  const calc=()=>{
    const aw=window.innerWidth-PAD*2-16, ah=window.innerHeight-248;
    return Math.max(24,Math.floor(Math.min(aw/(cols-1),ah/(rows-1))));
  };
  const [cs,setCs]=useState(calc);
  useEffect(()=>{ const h=()=>setCs(calc()); window.addEventListener("resize",h); return ()=>window.removeEventListener("resize",h); },[cols,rows]);
  return cs;
}

// ══════════════════════════════════════════════════════════════════
// SHARED STYLES
// ══════════════════════════════════════════════════════════════════
const page={width:"100%",minHeight:"100vh",background:"#04070F",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New',monospace",padding:"20px 12px",boxSizing:"border-box",overflowY:"auto"};
const card={background:"rgba(255,255,255,0.025)",border:"1px solid rgba(100,140,200,0.1)",borderRadius:12,padding:"16px 20px",width:"100%",maxWidth:320};
const lbl=(mb=12)=>({fontSize:8,letterSpacing:"0.3em",color:"rgba(150,180,255,0.36)",textTransform:"uppercase",marginBottom:mb,display:"block",textAlign:"center"});
const btn=(active=true)=>({background:active?"linear-gradient(135deg,#1c3f72,#0f2040)":"rgba(255,255,255,0.03)",border:`1px solid ${active?"rgba(100,160,255,0.42)":"rgba(100,140,200,0.1)"}`,color:active?"#CBD5E8":"rgba(150,180,255,0.4)",padding:"12px 36px",borderRadius:8,fontSize:11,letterSpacing:"0.28em",cursor:"pointer",textTransform:"uppercase",boxShadow:active?"0 0 22px rgba(0,80,200,0.2)":"none",transition:"all 0.2s"});

// ══════════════════════════════════════════════════════════════════
// SETUP SCREEN
// ══════════════════════════════════════════════════════════════════
function SetupScreen({ onStartLocal, onStartOnline }) {
  const [mode,setMode]=useState("local");
  const [gridKey,setGridKey]=useState("medium");
  const [numP,setNumP]=useState(1);
  const [types,setTypes]=useState(["human","human","human"]);
  const toggleT=i=>setTypes(t=>t.map((v,j)=>j===i?(v==="human"?"cpu":"human"):v));
  const go=()=>{
    if(mode==="online"){onStartOnline(gridKey,numP===1?2:numP);return;}
    const n=numP===1?2:numP;
    const colors=shuffle(PALETTE.slice(0,n));
    const players=numP===1?[{...colors[0],type:"human"},{...colors[1],type:"cpu"}]:Array.from({length:numP},(_,i)=>({...colors[i],type:types[i]}));
    onStartLocal(gridKey,players);
  };
  return (
    <div style={{...page,justifyContent:"space-evenly",padding:"24px 16px"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:10,letterSpacing:"0.5em",color:"rgba(150,180,255,0.35)",marginBottom:8,textTransform:"uppercase"}}>Grid · Lines · Triangles</div>
        <h1 style={{margin:0,fontSize:36,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",background:"linear-gradient(135deg,#CBD5E8,#7BA7D8)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Triangle Wars</h1>
        <div style={{fontSize:9,color:"rgba(150,180,255,0.3)",marginTop:6,letterSpacing:"0.1em"}}>Draw diagonals to define &amp; claim triangles</div>
      </div>
      <div style={{display:"flex",gap:10,width:"100%",maxWidth:380}}>
        {[["local","🎮 Pass & Play"],["online","🌐 Online"]].map(([m,lv])=>(
          <button key={m} onClick={()=>setMode(m)} style={{...btn(mode===m),flex:1,padding:"14px 10px",fontSize:11}}>{lv}</button>
        ))}
      </div>
      <div style={{...card,maxWidth:380}}>
        <span style={lbl()}>Grid Size</span>
        <div style={{display:"flex",gap:8}}>
          {GRID_PRESETS.map(g=>(
            <button key={g.key} onClick={()=>setGridKey(g.key)} style={{flex:1,padding:"14px 6px",borderRadius:8,cursor:"pointer",textAlign:"center",transition:"all 0.2s",background:gridKey===g.key?"linear-gradient(135deg,#1c3f72,#0f2040)":"rgba(255,255,255,0.03)",border:`1px solid ${gridKey===g.key?"rgba(100,160,255,0.42)":"rgba(100,140,200,0.1)"}`,boxShadow:gridKey===g.key?"0 0 14px rgba(0,80,200,0.18)":"none"}}>
              <div style={{fontSize:12,fontWeight:700,color:gridKey===g.key?"#CBD5E8":"rgba(150,180,255,0.45)"}}>{g.label}</div>
              <div style={{fontSize:8,color:gridKey===g.key?"rgba(150,200,255,0.55)":"rgba(150,180,255,0.25)",marginTop:4}}>{g.sub}</div>
            </button>
          ))}
        </div>
      </div>
      <div style={{...card,maxWidth:380}}>
        {mode==="local"?(
          <>
            <span style={lbl()}>Players</span>
            <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:16}}>
              {[1,2,3].map(n=>(
                <button key={n} onClick={()=>setNumP(n)} style={{width:52,height:52,borderRadius:10,fontSize:20,fontWeight:700,cursor:"pointer",background:numP===n?"linear-gradient(135deg,#1c3f72,#0f2040)":"rgba(255,255,255,0.03)",border:`1px solid ${numP===n?"rgba(100,160,255,0.42)":"rgba(100,140,200,0.1)"}`,color:numP===n?"#CBD5E8":"rgba(150,180,255,0.4)",transition:"all 0.2s"}}>{n}</button>
              ))}
            </div>
            {numP===1?(
              <div style={{textAlign:"center",padding:"8px 0"}}>
                <div style={{fontSize:28,marginBottom:8}}>🧑 vs 🤖</div>
                <div style={{fontSize:11,color:"rgba(150,180,255,0.45)",letterSpacing:"0.08em"}}>You vs Smart CPU</div>
              </div>
            ):(
              Array.from({length:numP},(_,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 0",borderBottom:i<numP-1?"1px solid rgba(100,140,200,0.07)":"none"}}>
                  <span style={{fontSize:13,color:"rgba(200,220,255,0.7)"}}>Player {i+1}{i===0?" (you)":""}</span>
                  <button onClick={()=>toggleT(i)} style={{padding:"6px 14px",borderRadius:6,fontSize:10,letterSpacing:"0.12em",cursor:"pointer",textTransform:"uppercase",background:types[i]==="human"?"rgba(0,180,100,0.12)":"rgba(140,90,220,0.12)",border:`1px solid ${types[i]==="human"?"rgba(0,210,110,0.3)":"rgba(160,100,255,0.3)"}`,color:types[i]==="human"?"rgba(0,220,120,0.9)":"rgba(180,130,255,0.9)"}}>{types[i]==="human"?"👤 Human":"🤖 CPU"}</button>
                </div>
              ))
            )}
          </>
        ):(
          <>
            <span style={lbl()}>Online Players</span>
            <div style={{display:"flex",gap:10}}>
              {[2,3].map(n=>(
                <button key={n} onClick={()=>setNumP(n)} style={{flex:1,padding:"14px",borderRadius:8,fontSize:14,fontWeight:700,cursor:"pointer",background:numP===n?"linear-gradient(135deg,#1c3f72,#0f2040)":"rgba(255,255,255,0.03)",border:`1px solid ${numP===n?"rgba(100,160,255,0.42)":"rgba(100,140,200,0.1)"}`,color:numP===n?"#CBD5E8":"rgba(150,180,255,0.4)",transition:"all 0.2s"}}>{n} Players</button>
              ))}
            </div>
            <div style={{fontSize:10,color:"rgba(150,180,255,0.28)",marginTop:14,textAlign:"center",letterSpacing:"0.08em"}}>Play from different devices via room code</div>
          </>
        )}
      </div>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:9,color:"rgba(150,180,255,0.24)",marginBottom:14,letterSpacing:"0.14em"}}>Colors randomly assigned at start</div>
        <button onClick={go} style={{...btn(),padding:"16px 48px",fontSize:12}}>{mode==="online"?"Next →":"Start Game"}</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ONLINE LOBBY
// ══════════════════════════════════════════════════════════════════
function OnlineLobby({ gridKey, maxPlayers, onBack, onReady }) {
  const [sub,setSub]=useState(null);
  const [roomCode,setRoomCode]=useState("");
  const [inputCode,setInputCode]=useState("");
  const [myName,setMyName]=useState("Player");
  const [myId,setMyId]=useState(null);
  const [sState,setSState]=useState(null);
  const [ws,setWs]=useState(null);
  const [err,setErr]=useState("");
  const wsRef=useRef(null);
  const myIdRef=useRef(null);
  const gp=GRID_PRESETS.find(g=>g.key===gridKey);
  const connect=(code,isCreate)=>{
    const socket=new WebSocket(`wss://${PARTYKIT_HOST}/party/${code}`);
    wsRef.current=socket;
    socket.onopen=()=>{
      setWs(socket);
      if(isCreate) socket.send(JSON.stringify({t:"create",name:myName,cols:gp.cols,rows:gp.rows,max:maxPlayers}));
      else socket.send(JSON.stringify({t:"join",name:myName}));
    };
    socket.onmessage=e=>{
      const d=JSON.parse(e.data);
      if(d.type==="hello"){setMyId(d.id);myIdRef.current=d.id;}
      if(d.type==="state"&&d.s){
        setSState(d.s);
        if(d.s.phase==="playing"){
          const players=d.s.players.map(p=>({...PALETTE[p.palIdx%3],type:"human",id:p.id,name:p.name}));
          const liveSocket=wsRef.current; wsRef.current=null; liveSocket.onmessage=null;
          onReady(players,liveSocket,myIdRef.current,code,d.s);
        }
      }
      if(d.type==="error"){setErr(d.msg);setTimeout(()=>setErr(""),3000);}
    };
    socket.onerror=()=>setErr("Connection failed — check PARTYKIT_HOST config");
    socket.onclose=()=>{setWs(null);};
  };
  useEffect(()=>()=>{wsRef.current?.close();},[]);
  const doCreate=()=>{const c=genCode();setRoomCode(c);setSub("create");connect(c,true);};
  const doJoin=()=>{if(!inputCode.trim())return;const c=inputCode.trim().toUpperCase();setRoomCode(c);setSub("join");connect(c,false);};
  const doStart=()=>ws?.readyState===1&&ws.send(JSON.stringify({t:"start"}));
  const goBack=()=>{wsRef.current?.close();setSub(null);setSState(null);};
  const isHost=sState&&myId&&sState.players[0]?.id===myId;
  const connCount=sState?.players.filter(p=>p.connected).length||0;
  if(!sub) return (
    <div style={page}>
      <button onClick={onBack} style={{position:"absolute",top:16,left:16,background:"transparent",border:"1px solid rgba(100,140,200,0.15)",color:"rgba(150,180,255,0.5)",padding:"6px 14px",borderRadius:6,fontSize:9,letterSpacing:"0.16em",cursor:"pointer",textTransform:"uppercase"}}>← Back</button>
      <h2 style={{margin:"0 0 6px",fontSize:20,fontWeight:700,letterSpacing:"0.1em",background:"linear-gradient(135deg,#CBD5E8,#7BA7D8)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Online Room</h2>
      <div style={{fontSize:10,color:"rgba(150,180,255,0.35)",marginBottom:24,letterSpacing:"0.08em"}}>{gp.label} grid · {maxPlayers} players</div>
      <div style={{marginBottom:20,textAlign:"center"}}>
        <div style={lbl()}>Your Name</div>
        <input value={myName} onChange={e=>setMyName(e.target.value)} maxLength={14} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(100,140,200,0.18)",color:"#CBD5E8",padding:"8px 14px",borderRadius:6,fontSize:13,letterSpacing:"0.06em",textAlign:"center",outline:"none",width:170,fontFamily:"'Courier New',monospace"}} />
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:260}}>
        <button onClick={doCreate} style={{...btn(),textAlign:"center",padding:"14px"}}>🏠 Create Room</button>
        <div style={{display:"flex",gap:8}}>
          <input value={inputCode} onChange={e=>setInputCode(e.target.value.toUpperCase())} placeholder="CODE" maxLength={4} style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(100,140,200,0.18)",color:"#CBD5E8",padding:"10px",borderRadius:8,fontSize:16,fontWeight:700,letterSpacing:"0.32em",textAlign:"center",outline:"none",fontFamily:"'Courier New',monospace"}} />
          <button onClick={doJoin} style={{...btn(!!inputCode.trim()),padding:"10px 16px",opacity:inputCode.trim()?1:0.4}}>Join</button>
        </div>
      </div>
      {err&&<div style={{marginTop:14,fontSize:10,color:"#FF4D6D",letterSpacing:"0.06em",textAlign:"center",maxWidth:280}}>{err}</div>}
    </div>
  );
  return (
    <div style={page}>
      <button onClick={goBack} style={{position:"absolute",top:16,left:16,background:"transparent",border:"1px solid rgba(100,140,200,0.15)",color:"rgba(150,180,255,0.5)",padding:"6px 14px",borderRadius:6,fontSize:9,letterSpacing:"0.16em",cursor:"pointer",textTransform:"uppercase"}}>← Back</button>
      <div style={{fontSize:9,letterSpacing:"0.4em",color:"rgba(150,180,255,0.38)",textTransform:"uppercase",marginBottom:10}}>{sub==="create"?"Room Created":"Room Joined"}</div>
      <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(100,140,200,0.15)",borderRadius:14,padding:"18px 32px",marginBottom:22,textAlign:"center"}}>
        <div style={lbl(8)}>Room Code</div>
        <div style={{fontSize:40,fontWeight:700,letterSpacing:"0.4em",color:"#CBD5E8",textShadow:"0 0 20px rgba(100,160,255,0.3)",fontFamily:"'Courier New',monospace"}}>{roomCode}</div>
        <div style={{fontSize:8,color:"rgba(150,180,255,0.3)",marginTop:8,letterSpacing:"0.12em"}}>Share with friends</div>
      </div>
      <div style={{...card,marginBottom:20}}>
        <div style={lbl()}>Players ({connCount}/{maxPlayers})</div>
        {sState?.players.map((p,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:i<sState.players.length-1?"1px solid rgba(100,140,200,0.06)":"none"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:p.connected?"#00D4FF":"rgba(150,180,255,0.2)",boxShadow:p.connected?"0 0 6px #00D4FF":"none",flexShrink:0}}/>
            <span style={{fontSize:11,color:"rgba(200,220,255,0.7)"}}>{p.name}</span>
            {p.id===sState.hostId&&<span style={{fontSize:7,color:"rgba(150,180,255,0.32)",marginLeft:"auto",letterSpacing:"0.1em"}}>HOST</span>}
          </div>
        ))}
        {Array.from({length:Math.max(0,maxPlayers-(sState?.players.length||0))}).map((_,i)=>(
          <div key={`e${i}`} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:"1px solid rgba(100,140,200,0.06)"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"rgba(100,140,200,0.15)"}}/>
            <span style={{fontSize:11,color:"rgba(150,180,255,0.25)",fontStyle:"italic"}}>waiting…</span>
          </div>
        ))}
      </div>
      {!ws&&<div style={{fontSize:10,color:"rgba(150,180,255,0.4)",marginBottom:14,animation:"pulse 1s ease-in-out infinite"}}>Connecting…</div>}
      {isHost&&connCount>=2&&<button onClick={doStart} style={btn()}>Start Game</button>}
      {isHost&&connCount<2&&<div style={{fontSize:10,color:"rgba(150,180,255,0.35)",letterSpacing:"0.1em",animation:"pulse 1.5s ease-in-out infinite"}}>Waiting for players…</div>}
      {!isHost&&sState&&<div style={{fontSize:10,color:"rgba(150,180,255,0.35)",letterSpacing:"0.1em",animation:"pulse 1.5s ease-in-out infinite"}}>Waiting for host to start…</div>}
      {err&&<div style={{marginTop:14,fontSize:10,color:"#FF4D6D"}}>{err}</div>}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// COLOR REVEAL
// ══════════════════════════════════════════════════════════════════
function ColorReveal({ players, onDone }) {
  return (
    <div style={page}>
      <div style={{fontSize:9,letterSpacing:"0.48em",color:"rgba(150,180,255,0.38)",textTransform:"uppercase",marginBottom:8}}>Colors Assigned!</div>
      <h2 style={{margin:"0 0 6px",fontSize:22,fontWeight:700,background:"linear-gradient(135deg,#CBD5E8,#7BA7D8)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Your colors this round</h2>
      <p style={{margin:"0 0 28px",fontSize:9,color:"rgba(150,180,255,0.3)",letterSpacing:"0.12em"}}>Randomly shuffled — good luck!</p>
      <div style={{display:"flex",gap:14,marginBottom:36,flexWrap:"wrap",justifyContent:"center"}}>
        {players.map((p,i)=>(
          <div key={i} style={{padding:"20px 22px",borderRadius:12,textAlign:"center",minWidth:108,background:`linear-gradient(135deg,${p.color}18,${p.color}08)`,border:`1px solid ${p.color}55`,boxShadow:`0 0 24px ${p.color}18`}}>
            <div style={{width:46,height:46,borderRadius:"50%",background:p.color,margin:"0 auto 12px",boxShadow:`0 0 20px ${p.color}`}}/>
            <div style={{fontSize:14,color:p.color,fontWeight:700}}>{p.name}</div>
            <div style={{fontSize:8,color:"rgba(150,180,255,0.4)",marginTop:3,letterSpacing:"0.1em"}}>Player {i+1}</div>
            <div style={{marginTop:9,fontSize:8,display:"inline-block",padding:"3px 9px",borderRadius:4,letterSpacing:"0.12em",color:p.type==="human"?"#CBD5E8":"rgba(180,130,255,0.85)",background:p.type==="human"?`${p.color}22`:"rgba(140,90,220,0.14)",border:`1px solid ${p.type==="human"?p.color+"44":"rgba(160,100,255,0.3)"}`}}>
              {p.type==="human"?"👤 YOU":"🤖 CPU"}
            </div>
          </div>
        ))}
      </div>
      <button onClick={onDone} style={btn()}>Let's Play →</button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// GAME BOARD
// ══════════════════════════════════════════════════════════════════
function GameBoard({ players, cols, rows, mode, socket, myId, initSS, onQuit }) {
  const canvasRef=useRef(null);
  const cs=useCellSize(cols,rows);
  const cW=PAD*2+(cols-1)*cs, cH=PAD*2+(rows-1)*cs;
  const grid=useMemo(()=>buildGrid(cols,rows),[cols,rows]);

  const [lDrawn,    setLDrawn]    =useState(()=>new Set());
  const [lClaimed,  setLClaimed]  =useState(()=>({}));
  const [lCellDiags,setLCellDiags]=useState(()=>({}));
  const [lScores,   setLScores]   =useState(()=>new Array(players.length).fill(0));
  const [lPIdx,     setLPIdx]     =useState(0);
  const [lOver,     setLOver]     =useState(false);
  const [sState,    setSState]    =useState(initSS);
  const sStateRef=useRef(initSS);
  useEffect(()=>{sStateRef.current=sState;},[sState]);
  const [selDot, setSelDot] =useState(null);
  const [dragPos,setDragPos]=useState(null);
  const [flash,  setFlash]  =useState([]);
  const [banner, setBanner] =useState("");
  const [aiLock, setAiLock] =useState(false);

  const drawn     =mode==="online"?new Set(sState?.drawn||[]):lDrawn;
  const cellDiags =mode==="online"?deriveCellDiags(sState?.drawn||[],cols):lCellDiags;
  const claimed   =mode==="online"?(sState?.claimed||{}):lClaimed;
  const scores    =mode==="online"?(sState?.players?.map(p=>p.score)||new Array(players.length).fill(0)):lScores;
  const pIdx      =mode==="online"?(sState?.cur??0):lPIdx;
  const gameOver  =mode==="online"?sState?.phase==="over":lOver;
  const isAI      =mode==="local"&&!gameOver&&players[lPIdx]?.type==="cpu";
  const isMyTurn  =mode==="local"||(players[pIdx]?.id===myId);
  const canAct    =!gameOver&&!aiLock&&isMyTurn&&!isAI;

  useEffect(()=>{
    if(mode!=="online"||!socket) return;
    const h=e=>{
      const d=JSON.parse(e.data);
      if(d.type==="state"&&d.s){
        const prev=sStateRef.current; setSState(d.s);
        if(prev&&d.s.claimed){
          const prevC=prev.claimed||{};
          const newKeys=Object.keys(d.s.claimed).filter(k=>prevC[k]===undefined);
          if(newKeys.length){
            if(navigator.vibrate) navigator.vibrate([30,10,30]);
            setFlash(newKeys);
            const owner=d.s.claimed[newKeys[0]];
            setBanner(`✦ ${d.s.players[owner]?.name} +${newKeys.length}!`);
            setTimeout(()=>{setFlash([]);setBanner("");},850);
          }
        }
      }
      if(d.type==="reset") onQuit();
    };
    socket.addEventListener("message",h);
    return ()=>socket.removeEventListener("message",h);
  },[socket,mode]);

  const execLocal=(ek,d,cl,cd,sc,pi)=>{
    const r=applyMove(ek,d,cl,cd,sc,pi,cols,rows);
    if(!r) return;
    if(navigator.vibrate) navigator.vibrate(r.scored?[30,10,30]:18);
    setLDrawn(r.nextDrawn); setLClaimed(r.nextClaimed); setLCellDiags(r.nextCellDiags); setLScores(r.nextScores);
    if(r.done){setLOver(true);return;}
    if(r.scored){
      setFlash(r.hitKeys); setBanner(`✦ +${r.hitKeys.length} — go again!`);
      setTimeout(()=>{setFlash([]);setBanner("");},850);
    } else {
      const next=(pi+1)%players.length;
      setBanner(`${players[next].name}'s turn`);
      setTimeout(()=>setBanner(""),1200);
      setLPIdx(next);
    }
  };

  const interactRef=useRef({drawn,claimed,cellDiags,scores,pIdx:lPIdx,selDot,canAct,execLocal});
  useEffect(()=>{interactRef.current={drawn,claimed,cellDiags,scores,pIdx:lPIdx,selDot,canAct,execLocal};},[drawn,claimed,cellDiags,scores,lPIdx,selDot,canAct]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    let activeSel=null;
    const getPos=ev=>{
      const r=canvas.getBoundingClientRect();
      return {x:(ev.clientX-r.left)*(canvas.width/r.width),y:(ev.clientY-r.top)*(canvas.height/r.height)};
    };
    const findDot=(x,y)=>{
      const lcs=(canvas.width-PAD*2)/(cols-1);
      const th=(lcs*0.65)**2; let hit=-1,best=th;
      for(let i=0;i<cols*rows;i++){
        const dx=PAD+(i%cols)*lcs-x,dy=PAD+Math.floor(i/cols)*lcs-y,d2=dx*dx+dy*dy;
        if(d2<best){best=d2;hit=i;}
      }
      return hit;
    };
    const tryEdge=(from,to)=>{
      const {drawn:d,claimed:cl,cellDiags:cd,scores:sc,pIdx:pi}=interactRef.current;
      if(!isAdjacentEdge(from,to,cols)){setBanner("⚠ Not adjacent");setTimeout(()=>setBanner(""),900);return false;}
      const ek=eKey(from,to);
      const dInfo=getDiagInfo(ek,cols);
      if(dInfo){const ck=`${dInfo.cellR}_${dInfo.cellC}`;if(cd[ck]&&cd[ck]!==dInfo.dir){setBanner("⚠ Diagonal locked");setTimeout(()=>setBanner(""),900);return false;}}
      if(d.has(ek)){setBanner("⚠ Already drawn");setTimeout(()=>setBanner(""),900);return false;}
      if(mode==="online"){if(navigator.vibrate)navigator.vibrate(18);socket?.send(JSON.stringify({t:"move",edge:ek}));}
      else execLocal(ek,d,cl,cd,sc,pi);
      return true;
    };
    const onDown=ev=>{
      if(!interactRef.current.canAct) return;
      ev.preventDefault();
      const {x,y}=getPos(ev); const dot=findDot(x,y);
      if(dot===-1){setSelDot(null);setDragPos(null);return;}
      const prevSel=interactRef.current.selDot;
      if(prevSel!==null&&prevSel!==dot){if(tryEdge(prevSel,dot)){activeSel=null;setSelDot(null);setDragPos(null);return;}}
      if(prevSel===dot){setSelDot(null);setDragPos(null);activeSel=null;return;}
      activeSel=dot; setSelDot(dot); setDragPos({x,y});
      try{canvas.setPointerCapture(ev.pointerId);}catch(_){}
    };
    const onMove=ev=>{if(activeSel===null)return;ev.preventDefault();const{x,y}=getPos(ev);setDragPos({x,y});};
    const onUp=ev=>{
      if(activeSel===null)return;
      const{x,y}=getPos(ev);const dot=findDot(x,y);setDragPos(null);
      if(dot!==-1&&dot!==activeSel){tryEdge(activeSel,dot);setSelDot(null);}
      if(dot===-1)setSelDot(null);activeSel=null;
    };
    canvas.addEventListener("pointerdown",onDown,{passive:false});
    canvas.addEventListener("pointermove",onMove,{passive:false});
    canvas.addEventListener("pointerup",onUp);
    canvas.addEventListener("pointercancel",onUp);
    return ()=>{canvas.removeEventListener("pointerdown",onDown);canvas.removeEventListener("pointermove",onMove);canvas.removeEventListener("pointerup",onUp);canvas.removeEventListener("pointercancel",onUp);};
  },[cols,rows,mode,socket]);

  // eslint-disable-next-line
  useEffect(()=>{
    if(mode!=="local"||lOver||!players[lPIdx]||players[lPIdx].type!=="cpu"||aiLock) return;
    let dead=false;
    const run=(d,cl,cd,sc,pi)=>{
      if(dead) return;
      setAiLock(true);
      setTimeout(()=>{
        if(dead) return;
        const ek=aiPick(d,cl,cd,cols,rows);
        if(!ek){setLOver(true);setAiLock(false);return;}
        const r=applyMove(ek,d,cl,cd,sc,pi,cols,rows);
        if(!r){setAiLock(false);return;}
        setLDrawn(r.nextDrawn);setLClaimed(r.nextClaimed);setLCellDiags(r.nextCellDiags);setLScores(r.nextScores);
        if(r.done){setLOver(true);setAiLock(false);return;}
        if(r.scored){
          setFlash(r.hitKeys);setBanner(`🤖 ${players[pi].name} +${r.hitKeys.length}!`);
          setTimeout(()=>{if(dead)return;setFlash([]);setBanner("");run(r.nextDrawn,r.nextClaimed,r.nextCellDiags,r.nextScores,pi);},620);
        } else {
          const next=(pi+1)%players.length;
          setBanner(`${players[next].name}'s turn`);
          setTimeout(()=>{if(dead)return;setBanner("");setLPIdx(next);setAiLock(false);},800);
        }
      },660);
    };
    run(lDrawn,lClaimed,lCellDiags,lScores,lPIdx);
    return ()=>{dead=true;};
  },[lPIdx,lOver,mode]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,cW,cH); ctx.fillStyle="#080C14"; ctx.fillRect(0,0,cW,cH);
    for(let x=0;x<=cW;x+=34) for(let y=0;y<=cH;y+=34){ctx.beginPath();ctx.arc(x,y,0.65,0,Math.PI*2);ctx.fillStyle="rgba(255,255,255,0.045)";ctx.fill();}

    // Triangle fills
    Object.entries(cellDiags).forEach(([ck,dir])=>{
      const [cr,cc]=ck.split("_").map(Number);
      [0,1].forEach(ti=>{
        const owner=claimed[`${cr}_${cc}_${ti}`]; if(owner===undefined) return;
        const verts=getTriVerts(cr,cc,dir,ti,cs);
        const isF=flash.includes(`${cr}_${cc}_${ti}`);
        ctx.beginPath();ctx.moveTo(verts[0].x,verts[0].y);ctx.lineTo(verts[1].x,verts[1].y);ctx.lineTo(verts[2].x,verts[2].y);ctx.closePath();
        ctx.fillStyle=isF?players[owner].color+"5A":players[owner].fill;ctx.fill();
      });
    });

    // Faint H+V grid
    for(const ek of grid.allEdges){
      const [a,b]=ek.split("|").map(Number);
      const ax=PAD+(a%cols)*cs,ay=PAD+Math.floor(a/cols)*cs,bx=PAD+(b%cols)*cs,by=PAD+Math.floor(b/cols)*cs;
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);
      ctx.strokeStyle=drawn.has(ek)?"rgba(190,215,255,0.5)":"rgba(90,130,195,0.14)";
      ctx.lineWidth=drawn.has(ek)?1.6:1;ctx.stroke();
    }

    // Player-drawn diagonals
    for(const ek of drawn){
      if(!getDiagInfo(ek,cols)) continue;
      const [a,b]=ek.split("|").map(Number);
      const ax=PAD+(a%cols)*cs,ay=PAD+Math.floor(a/cols)*cs,bx=PAD+(b%cols)*cs,by=PAD+Math.floor(b/cols)*cs;
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.strokeStyle="rgba(190,215,255,0.5)";ctx.lineWidth=1.6;ctx.stroke();
    }

    // Claimed edge highlights
    const edgeOwners={};
    Object.entries(cellDiags).forEach(([ck,dir])=>{
      const [cr,cc]=ck.split("_").map(Number);
      getCellTriEdges(cr,cc,dir,cols).forEach((edges,ti)=>{
        const owner=claimed[`${cr}_${cc}_${ti}`]; if(owner===undefined) return;
        edges.forEach(e=>(edgeOwners[e]=edgeOwners[e]||new Set()).add(owner));
      });
    });
    for(const [e,owners] of Object.entries(edgeOwners)){
      const arr=[...owners];
      const [a,b]=e.split("|").map(Number);
      const ax=PAD+(a%cols)*cs,ay=PAD+Math.floor(a/cols)*cs,bx=PAD+(b%cols)*cs,by=PAD+Math.floor(b/cols)*cs;
      if(arr.length===1){
        ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);
        ctx.strokeStyle=players[arr[0]].color+"70";ctx.lineWidth=2.2;
        ctx.shadowColor=players[arr[0]].color;ctx.shadowBlur=5;ctx.stroke();ctx.shadowBlur=0;
      } else {
        const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy),nx=(-dy/len)*2.4,ny=(dx/len)*2.4;
        arr.slice(0,2).forEach((owner,idx)=>{
          const s=idx===0?1:-1;
          ctx.beginPath();ctx.moveTo(ax+nx*s,ay+ny*s);ctx.lineTo(bx+nx*s,by+ny*s);
          ctx.strokeStyle=players[owner].color;ctx.lineWidth=2;
          ctx.shadowColor=players[owner].color;ctx.shadowBlur=6;ctx.stroke();ctx.shadowBlur=0;
        });
      }
    }

    // Flash outlines
    flash.forEach(claimKey=>{
      const p=claimKey.split("_");const cr=+p[0],cc=+p[1],ti=+p[2];
      const dir=cellDiags[`${cr}_${cc}`]; if(!dir) return;
      const owner=claimed[claimKey]; if(owner===undefined) return;
      const verts=getTriVerts(cr,cc,dir,ti,cs);
      ctx.beginPath();ctx.moveTo(verts[0].x,verts[0].y);ctx.lineTo(verts[1].x,verts[1].y);ctx.lineTo(verts[2].x,verts[2].y);ctx.closePath();
      ctx.strokeStyle=players[owner].color;ctx.lineWidth=2.5;
      ctx.shadowColor=players[owner].color;ctx.shadowBlur=22;ctx.stroke();ctx.shadowBlur=0;
    });

    // Selection preview — H, V, and non-conflicting diagonals
    if(selDot!==null&&canAct){
      const sx=PAD+(selDot%cols)*cs,sy=PAD+Math.floor(selDot/cols)*cs;
      ctx.setLineDash([4,5]);ctx.lineWidth=1;
      for(let i=0;i<cols*rows;i++){
        if(i===selDot||!isAdjacentEdge(selDot,i,cols)) continue;
        const ek2=eKey(selDot,i); if(drawn.has(ek2)) continue;
        const dI=getDiagInfo(ek2,cols);
        if(dI){const ck=`${dI.cellR}_${dI.cellC}`;if(cellDiags[ck]&&cellDiags[ck]!==dI.dir) continue;}
        const nx2=PAD+(i%cols)*cs,ny2=PAD+Math.floor(i/cols)*cs;
        ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(nx2,ny2);ctx.strokeStyle=players[pIdx].color+"28";ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(sx,sy,DOT_R+9,0,Math.PI*2);
      ctx.strokeStyle=players[pIdx].color;ctx.lineWidth=1.8;
      ctx.shadowColor=players[pIdx].color;ctx.shadowBlur=16;ctx.stroke();ctx.shadowBlur=0;
    }

    // Live drag line
    if(selDot!==null&&dragPos!==null&&canAct){
      const sx=PAD+(selDot%cols)*cs,sy=PAD+Math.floor(selDot/cols)*cs;
      ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(dragPos.x,dragPos.y);
      ctx.strokeStyle=players[pIdx].color+"AA";ctx.lineWidth=2;
      ctx.setLineDash([6,4]);ctx.shadowColor=players[pIdx].color;ctx.shadowBlur=8;
      ctx.stroke();ctx.setLineDash([]);ctx.shadowBlur=0;
    }

    // Dots
    for(let i=0;i<cols*rows;i++){
      const x=PAD+(i%cols)*cs,y=PAD+Math.floor(i/cols)*cs,isSel=i===selDot;
      ctx.beginPath();ctx.arc(x,y,isSel?DOT_R+1.5:DOT_R,0,Math.PI*2);
      ctx.fillStyle=isSel?players[pIdx].color:"#B8CAE0";
      ctx.shadowColor=isSel?players[pIdx].color:"rgba(150,180,255,0.28)";
      ctx.shadowBlur=isSel?18:4;ctx.fill();ctx.shadowBlur=0;
    }
  },[drawn,claimed,cellDiags,selDot,dragPos,pIdx,players,flash,cs,cW,cH,grid,cols,rows,canAct]);

  const maxSc=Math.max(...scores);
  const winIdx=scores.indexOf(maxSc);
  const isTie=scores.filter(s=>s===maxSc).length>1;
  const progress=Math.min(Object.keys(claimed).length/((cols-1)*(rows-1)*2),1);
  const curPDisconnected=mode==="online"&&sState?.players[pIdx]?.connected===false;

  return (
    <div style={{...page,padding:"8px 8px",justifyContent:"flex-start",paddingTop:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",maxWidth:cW,marginBottom:6}}>
        <h1 style={{margin:0,fontSize:16,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",background:"linear-gradient(135deg,#CBD5E8,#7BA7D8)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Triangle Wars</h1>
        <button onClick={onQuit} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(100,140,200,0.15)",color:"rgba(150,180,255,0.5)",padding:"5px 12px",borderRadius:6,fontSize:9,letterSpacing:"0.18em",cursor:"pointer",textTransform:"uppercase",transition:"all 0.2s"}}
          onMouseOver={e=>{e.target.style.color="#FF4D6D";e.target.style.borderColor="rgba(255,77,109,0.4)";}}
          onMouseOut={e=>{e.target.style.color="rgba(150,180,255,0.5)";e.target.style.borderColor="rgba(100,140,200,0.15)";}}>⌂ Menu</button>
      </div>
      <div style={{width:"100%",maxWidth:cW,height:3,background:"rgba(100,140,200,0.1)",borderRadius:2,marginBottom:7,overflow:"hidden"}}>
        <div style={{height:"100%",borderRadius:2,transition:"width 0.4s",background:"linear-gradient(90deg,rgba(100,160,255,0.5),rgba(150,200,255,0.3))",width:`${progress*100}%`}}/>
      </div>
      {!gameOver&&(
        <div style={{height:20,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:6}}>
          {isAI?(<div style={{fontSize:10,color:players[pIdx].color,animation:"pulse 1s ease-in-out infinite"}}>🤖 {players[pIdx].name} is thinking…</div>)
          :curPDisconnected?(<div style={{fontSize:10,color:"#FF4D6D",animation:"pulse 1s ease-in-out infinite"}}>⚠ {players[pIdx]?.name} disconnected — skipping…</div>)
          :banner?(<div style={{fontSize:10,color:players[pIdx%players.length].color,letterSpacing:"0.06em"}}>{banner}</div>)
          :(<div style={{fontSize:10,color:players[pIdx].color,textShadow:`0 0 10px ${players[pIdx].color}44`}}>● {players[pIdx].name}'s turn{isMyTurn&&players[pIdx].type==="human"?" — draw a line":""}{mode==="online"&&!isMyTurn?" (watching)":""}</div>)}
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:15,width:"100%"}}>
        <div style={{position:"relative",width:"100%",display:"flex",justifyContent:"center"}}>
          <canvas ref={canvasRef} width={cW} height={cH}
            style={{display:"block",borderRadius:10,border:"1px solid rgba(100,140,200,0.12)",cursor:canAct?"crosshair":"default",boxShadow:"0 0 30px rgba(0,50,160,0.18)",maxWidth:"100%",touchAction:"none"}}/>
          {gameOver&&(
            <div style={{position:"absolute",inset:0,background:"rgba(4,7,15,0.92)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",borderRadius:10,backdropFilter:"blur(5px)"}}>
              <div style={{fontSize:26,fontWeight:700,color:isTie?"#CBD5E8":players[winIdx].color}}>{isTie?"Tie!":"Winner!"}</div>
              <button onClick={onQuit} style={btn()}>Menu</button>
            </div>
          )}
        </div>
        <div style={{display:"flex",flexDirection:"row",flexWrap:"wrap",justifyContent:"center",gap:8,width:"100%"}}>
          {players.map((p,i)=>{
            const active=i===pIdx&&!gameOver;
            return(<div key={i} style={{flex:"1 1 30%",minWidth:"90px",padding:"8px",borderRadius:9,background:active?`${p.color}22`:"rgba(255,255,255,0.03)",border:`1px solid ${active?p.color:"rgba(100,140,200,0.1)"}`,textAlign:"center"}}>
              <div style={{fontSize:9,color:active?p.color:"rgba(150,180,255,0.3)"}}>{p.name}</div>
              <div style={{fontSize:20,fontWeight:700,color:active?p.color:"#FFF"}}>{scores[i]}</div>
            </div>);
          })}
        </div>
        <div style={{width:"100%",padding:"8px 10px",borderRadius:7,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,140,200,0.06)"}}>
          {[["Tap dot","select"],["Tap dot","connect"],["Drag","quick draw"],["Draw diagonal","locks cell direction · forms △"]].map(([a,r],i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",gap:6,marginBottom:3}}>
              <span style={{fontSize:8,color:"rgba(150,180,255,0.32)"}}>{a}</span>
              <span style={{fontSize:8,color:"rgba(150,180,255,0.2)"}}>{r}</span>
            </div>
          ))}
        </div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.45}}`}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════════
export default function App() {
  const [phase,   setPhase]   =useState("setup");
  const [gameMode,setGameMode]=useState("local");
  const [gridKey, setGridKey] =useState("medium");
  const [maxP,    setMaxP]    =useState(2);
  const [players, setPlayers] =useState([]);
  const [socket,  setSocket]  =useState(null);
  const [myId,    setMyId]    =useState(null);
  const [initSS,  setInitSS]  =useState(null);
  const gp=GRID_PRESETS.find(g=>g.key===gridKey);
  const startLocal =(gk,plrs)=>{setGridKey(gk);setPlayers(plrs);setGameMode("local");setPhase("reveal");};
  const startOnline=(gk,mp)  =>{setGridKey(gk);setMaxP(mp);setGameMode("online");setPhase("online_lobby");};
  const onReady=(plrs,ws,mid,_rc,ss)=>{setPlayers(plrs);setSocket(ws);setMyId(mid);setInitSS(ss);setPhase("game");};
  const quit=()=>{
    if(socket){socket.send(JSON.stringify({t:"quit"}));socket.close();setSocket(null);}
    setInitSS(null);setPlayers([]);setPhase("setup");
  };
  if(phase==="setup")        return <SetupScreen onStartLocal={startLocal} onStartOnline={startOnline}/>;
  if(phase==="online_lobby") return <OnlineLobby gridKey={gridKey} maxPlayers={maxP} onBack={()=>setPhase("setup")} onReady={onReady}/>;
  if(phase==="reveal")       return <ColorReveal players={players} onDone={()=>setPhase("game")}/>;
  return <GameBoard players={players} cols={gp.cols} rows={gp.rows} mode={gameMode} socket={socket} myId={myId} initSS={initSS} onQuit={quit}/>;
}
