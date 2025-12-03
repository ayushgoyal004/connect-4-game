const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const GameManager = require('./src/gameManager');
const Store = require('./src/store');
const Kafka = require('./src/kafka');
const app = express();
app.use(bodyParser.json());
app.use(cors()); // allow all origins (OK for local dev)
const PORT = process.env.PORT || 4005;
const WS_PORT = process.env.WS_PORT || 4006;
const store = new Store(); // Postgres wrapper
const kafka = new Kafka(); // Kafka producer (no-op if not configured)
const gm = new GameManager({ store, kafka });
// Simple matchmaking endpoint
app.post('/match',async(req,res)=>{
  const {username}=req.body;
  if (!username) return res.status(400).json({error:'username required'});

  const game=gm.joinQueue(username);
  // returns whether matched or waiting + gameId
  res.json({gameId:game.id,status:game.status});
});

// Leaderboard
app.get('/leaderboard',async(req, res)=>{
  const lb=await store.getLeaderboard();
  res.json(lb);
});

// Minimal health
app.get('/health',(req,res)=>res.json({ok:true}));

const server =app.listen(PORT,()=>{
  console.log(`HTTP server running on ${PORT}`);
});

// WebSocket server
const wss=new WebSocketServer({port:WS_PORT});
console.log(`WebSocket server running on port ${WS_PORT}`);

wss.on('connection', (ws, req) => {
  // query params: gameId & username
  const params=new URLSearchParams(req.url.replace('/?',''));
  const gameId=params.get('gameId');
  const username= params.get('username');

  if (!username){
    ws.send(JSON.stringify({type:'error',message:'username required in ws query'}));
    ws.close();
    return;
  }

  try{
    gm.handleWSConnection({ws,gameId,username});
  } catch(err){
    console.error('ws connection error',err);
    ws.send(JSON.stringify({type:'error',message:'server error'}));
    ws.close();
  }
});

process.on('SIGINT',async()=>{
  console.log('Shutting down...');
  await store.close();
  process.exit(0);
});