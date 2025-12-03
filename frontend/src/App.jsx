import React, { useState, useRef, useEffect } from 'react';

const HTTP_PORT = 4005;
const WS_PORT = 4006;
const API_BASE = `http://localhost:${HTTP_PORT}`;
const WS_BASE = `ws://localhost:${WS_PORT}/`;

export default function App(){
  const [username, setUsername]=useState('');
  const [status, setStatus]=useState('');
  const [info, setInfo]=useState('');
  const [board, setBoard]=useState(Array.from({length:6}, ()=>Array(7).fill(0)));
  const [currentState, setCurrentState] =useState(null);
  const [leaderboard, setLeaderboard] =useState([]);
  const [logLines, setLogLines]= useState([]);
  const socketRef =useRef(null);
  const myUsernameRef=useRef(null);

  useEffect(() => { fetchLeaderboard(); }, []);

  function log(s){
    setLogLines(l =>[`${new Date().toLocaleTimeString()} — ${s}`, ...l].slice(0,200));
  }

  async function fetchLeaderboard(){
    try {
      const res=await fetch(`${API_BASE}/leaderboard`);
      const j=await res.json();
      setLeaderboard(j || []);
    } catch (err){
      log('failed get leaderboard: ' + (err.message||err));
    }
  }

  async function handleMatch(){
    if(!username.trim()) return alert('enter username');
    setStatus('matching...');
    try{
      const res=await fetch(`${API_BASE}/match`, {
        method: 'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ username: username.trim() })
      });
      const j=await res.json();
      log('match response: ' +JSON.stringify(j));
      connectWS(j.gameId,username.trim());
      setInfo(`gameId: ${j.gameId} — status: ${j.status}`);
    } catch (err){
      setStatus('error');
      log('match error: ' + (err.message||err));
    }
  }

  function connectWS(gameId,uname){
    if (socketRef.current){
      try{socketRef.current.close();} catch(e){}
    }
    myUsernameRef.current=uname;
    const url =`${WS_BASE}?gameId=${encodeURIComponent(gameId)}&username=${encodeURIComponent(uname)}`;
    const ws =new WebSocket(url);
    socketRef.current = ws;
    ws.addEventListener('open', () => {
      setStatus('ws open');
      log('ws open ' + url);
    });

    ws.addEventListener('message',(ev)=>{
      try{
        const msg=JSON.parse(ev.data);
        log('recv: '+JSON.stringify(msg));
        handleServerMsg(msg);
      } catch(e){
        log('invalid msg: '+ev.data);
      }
    });

    ws.addEventListener('close',()=>{
      setStatus('ws closed');
      log('ws closed');
    });

    ws.addEventListener('error',(e)=>{
      setStatus('ws error');
      log('ws error');
    });
  }

  function handleServerMsg(msg){
    if (msg.type ==='state'){
      setCurrentState(msg);
      setBoard(msg.board);
      let opponent='(waiting...)';
      if (msg.players){
        const p1 =msg.players.player1;
        const p2= msg.players.player2;
        if (!p2) opponent= '(waiting...)';
        else {
          const other =(p1 ===myUsernameRef.current) ? p2:p1;
          if (msg.isBot || (typeof other === 'string' && other.startsWith('BOT_'))) opponent = 'Computer (Bot)';
          else opponent=other;
        }
      }
      setInfo(`You: ${myUsernameRef.current} • Opponent: ${opponent} • Turn: ${msg.turn} • status: ${msg.status}`);
    } else if (msg.type==='move'){
      //optimistic update handled by state messages
      log('move: ' +JSON.stringify(msg));
    } else if (msg.type === 'end'){
      setInfo(`Game ended: ${msg.result} ${msg.winner ? ('winner: ' + msg.winner) : ''}`);
    } else if (msg.type === 'error'){
      alert('Server error: ' + msg.message);
    }
  }

  function sendDrop(col){
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return alert('ws not open');
    socketRef.current.send(JSON.stringify({ type:'drop', col }));
    log('sent drop col ' + col);
  }

  return (
    <div>
      <h3>Connect4</h3>
      <div className="controls">
        <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="username" />
        <button onClick={handleMatch}>Find Match</button>
        <button onClick={fetchLeaderboard}>Refresh Leaderboard</button>
        <span style={{marginLeft:12,color:'green'}}>{status}</span>
      </div>

      <div className="info">{info}</div>

      <div className="board" role="grid">
        {board.map((row,r)=> row.map((cell,c) => {
          const cls = 'cell' + (cell===1 ? ' p1' : cell===2 ? ' p2' : '');
          return <div key={`${r}-${c}`} className={cls} title={r===0?`col ${c}`:''}
            onClick={()=> {
              if (!currentState) return alert('No game state');
              if (currentState.status !== 'ongoing') return alert('Game finished or waiting');
              if (currentState.turn !== myUsernameRef.current) return alert('Not your turn');
              sendDrop(c);
            }} />;
        }))}
      </div>

      <div className="leaderboard">
        <strong>Leaderboard:</strong>
        <ul>
          {leaderboard.length===0 ? <li>(no records)</li> : leaderboard.map((r)=> <li key={r.username}>{r.username} — {r.wins}</li>)}
        </ul>
      </div>

      <div className="log">
        {logLines.map((l,idx)=><div key={idx}>{l}</div>)}
      </div>
    </div>
  );
}