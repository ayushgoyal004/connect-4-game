const EventEmitter= require('events');

function createEmptyBoard() {
  return Array.from({length:6},()=>Array(7).fill(0));
}

class Game extends EventEmitter {
  constructor({id,player1,player2=null,bot=null,store,kafka, manager }) {
    super();

    this.id=id;
    this.player1=player1;
    this.player2= player2;
    this.bot=bot;
    this.store= store;
    this.kafka= kafka;
    this.manager= manager;

    this.board= createEmptyBoard();
    this.turn= this.player1;
    this.status=player2 ? 'ongoing':'waiting';
    this.moves =[];
    this.sockets=new Map();           // username -> ws
    this.reconnectTimers=new Map();   // username -> timeout
    this.createdAt=Date.now();

    if (this.isBotTurn() && this.status ==='ongoing') {
      this.makeBotMove();
    }
  }

  attachWS(username,ws) {
    // If this username had a reconnect timer, clear it (they are reconnecting)
    if (this.reconnectTimers.has(username)) {
      clearTimeout(this.reconnectTimers.get(username));
      this.reconnectTimers.delete(username);
    }

    // If player2 slot is empty and a new human joins (not the same as player1), occupy it
    if (!this.player2 && username!==this.player1) {
      this.player2=username;
      this.manager.userToGame.set(username, this.id);
      this.status='ongoing';

      this.kafka.emit('game_start',{
        gameId:this.id,
        players:[this.player1, this.player2],
        bot:false,
        ts:new Date().toISOString()
      });

      this.broadcast({
        type:'state',
        board:this.board,
        turn:this.turn,
        status:this.status,
        players:{ player1: this.player1, player2: this.player2 },
        isBot: !!this.bot
      });
    }

    //Attach socket for this username (new connection or reconnection)
    this.sockets.set(username, ws);

    ws.on('message', (msg) => {
      try{
        const j=JSON.parse(msg.toString());
        this.handleMessage(username, j);
      } catch (err) {
        ws.send(JSON.stringify({type:'error',message:'invalid json'}));
      }
    });

    ws.on('close',()=>this.handleDisconnect(username));

    //Send current authoritative state to the connected client
    ws.send(JSON.stringify({
      type:'state',
      board:this.board,
      turn:this.turn,
      status:this.status,
      players:{ player1: this.player1, player2: this.player2 },
      isBot:!!this.bot
    }));
  }

  handleMessage(username, msg) {
    if (msg.type==='drop') {
      if (this.status!== 'ongoing')
        return this.sendTo(username,{type:'error',message:'game finished'});

      if (username!==this.turn)
        return this.sendTo(username,{type:'error',message:'not your turn'});

      const col =Number(msg.col);
      const row =this.dropDisc(col, username === this.player1 ? 1 : 2);
      if (row=== -1)
        return this.sendTo(username,{type:'error',message:'invalid column'});

      const move={player:username,col,row,ts:new Date().toISOString()};
      this.moves.push(move);
      this.kafka.emit('move',{gameId:this.id, ...move });

      this.broadcast({type:'move', ...move});

      // WIN CHECK
      const winner=this.checkWin(row, col);
      if (winner){
        this.status= 'finished';
        this.broadcast({
          type:'state',
          board: this.board,
          turn:this.turn,
          status:this.status,
          players:{ player1: this.player1, player2: this.player2 },
          isBot: !!this.bot
        });
        const winnerName= winner=== 1 ?this.player1 :this.player2;
        this.endGame({result:'win',winner:winnerName });
        return;
      }

      // DRAW CHECK
      if (this.isDraw()) {
        this.status ='finished';
        this.broadcast({
          type:'state',
          board:this.board,
          turn:this.turn,
          status:this.status,
          players:{player1:this.player1,player2:this.player2},
          isBot: !!this.bot
        });
        this.endGame({result:'draw'});
        return;
      }

      // SWITCH TURN
      this.turn =this.turn===this.player1 ?this.player2:this.player1;
      this.broadcast({
        type: 'state',
        board:this.board,
        turn:this.turn,
        status:this.status,
        players:{ player1: this.player1, player2: this.player2 },
        isBot: !!this.bot
      });

      if (this.isBotTurn()) {
        setTimeout(()=>this.makeBotMove(),150);
      }
    }
  }

  sendTo(username,obj) {
    const ws=this.sockets.get(username);
    if (ws && ws.readyState===ws.OPEN) ws.send(JSON.stringify(obj));
  }

  broadcast(obj) {
    for (const [u,ws] of this.sockets.entries()) {
      if (ws && ws.readyState===ws.OPEN) ws.send(JSON.stringify(obj));
    }
  }

  isBotTurn() {
    return this.bot && this.turn===this.player2;
  }

  dropDisc(col,playerId) {
    if (col<0 || col>6) return -1;
    for (let r=5; r>=0;r--) {
      if (this.board[r][col] === 0) {
        this.board[r][col]= playerId;
        return r;
      }
    }
    return -1;
  }

  checkWin(r,c) {
    const pid = this.board[r][c];
    if (!pid) return false;
    const dirs =[
      [[0,1],[0,-1]],
      [[1,0],[-1,0]],
      [[1,1],[-1,-1]],
      [[1,-1],[-1,1]]
    ];
    for (const dir of dirs) {
      let count= 1;
      for (const [dr,dc] of dir) {
        let rr = r+dr, cc =c+dc;
        while (rr>=0 && rr<6 && cc>=0 && cc<7 && this.board[rr][cc]===pid) {
          count++; rr+=dr; cc+=dc;
        }
      }
      if (count>=4) return pid;
    }
    return false;
  }

  isDraw() {
    return this.board[0].every(x=>x!==0);
  }

  makeBotMove() {
    if (!this.bot||this.status!=='ongoing') return;

    const botId=2;
    const opponentId= 1;

    const col=this.bot.chooseMove(this.board, botId, opponentId);
    const row= this.dropDisc(col, botId);

    const move= { player: this.player2, col, row, ts: new Date().toISOString() };
    this.moves.push(move);
    this.kafka.emit('move',{gameId:this.id, ...move});
    this.broadcast({ type:'move', ...move });

    const winner= this.checkWin(row,col);
    if (winner){
      this.status= 'finished';
      this.broadcast({
        type:'state',
        board:this.board,
        turn: this.turn,
        status:this.status,
        players:{ player1: this.player1, player2: this.player2 },
        isBot: !!this.bot
      });
      const winnerName= winner === 1 ? this.player1 : this.player2;
      this.endGame({result:'win',winner:winnerName});
      return;
    }

    if (this.isDraw()) {
      this.status ='finished';
      this.broadcast({
        type:'state',
        board: this.board,
        turn:this.turn,
        status: this.status,
        players:{ player1: this.player1, player2: this.player2 },
        isBot: !!this.bot
      });
      this.endGame({result:'draw'});
      return;
    }

    this.turn =this.player1;
    this.broadcast({
      type: 'state',
      board:this.board,
      turn: this.turn,
      status:this.status,
      players: { player1: this.player1, player2: this.player2 },
      isBot: !!this.bot
    });
  }

  handleDisconnect(username) {
    // Remove socket (user disconnected)
    this.sockets.delete(username);

    // If they already had a reconnect timer, clear it just in case (we'll set a fresh one)
    if (this.reconnectTimers.has(username)) {
      clearTimeout(this.reconnectTimers.get(username));
      this.reconnectTimers.delete(username);
    }

    // Start a 30s timer allowing them to reconnect
    const t = setTimeout(() => {
      this.reconnectTimers.delete(username);

      // If game already finished, nothing to do
      if (this.status === 'finished') return;

      const other = username === this.player1 ? this.player2 : this.player1;
      const otherSocket = other ? this.sockets.get(other) : null;

      // If the other player is connected -> disconnected user forfeits immediately
      if (other && otherSocket && otherSocket.readyState === otherSocket.OPEN) {
        this.status = 'finished';
        this.endGame({ result: 'forfeit', winner: other });
        return;
      }

      // If nobody is connected (both disconnected) -> declare draw
      if (this.sockets.size === 0) {
        this.status = 'finished';
        this.endGame({ result: 'draw' });
        return;
      }

      // Otherwise (other not connected but some socket exists) fall back: forfeit disconnected user
      if (other) {
        this.status = 'finished';
        this.endGame({result:'forfeit',winner:other});
      } else {
        this.status ='finished';
        this.endGame({result:'draw'});
      }
    },30_000);

    this.reconnectTimers.set(username,t);
  }

  async endGame({result,winner}){
    // clear all reconnect timers
    for (const t of this.reconnectTimers.values()) clearTimeout(t);
    this.reconnectTimers.clear();

    const duration = Math.floor((Date.now()-this.createdAt)/1000);

    const rec = {
      id: this.id,
      created_at:new Date().toISOString(),
      duration_seconds: duration,
      player1: this.player1,
      player2:this.player2,
      winner:result === 'draw' ? 'draw' : winner,
      moves:JSON.stringify(this.moves),
      analytics: JSON.stringify({ result })
    };

    try {
      await this.store.saveGame(rec);
      if (result!== 'draw' && winner) await this.store.incWin(winner);
    } catch(err){
      console.error('persist error',err);
    }

    this.kafka.emit('game_end',{
      gameId: this.id,
      winner: rec.winner,
      duration,
      moves:this.moves.length,
      ts:new Date().toISOString()
    });

    this.broadcast({type:'end',result,winner:rec.winner });

    this.manager.finishGame(this.id);
  }
}

module.exports = Game;