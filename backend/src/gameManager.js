const { v4: uuidv4 }= require('uuid');
const Game =require('./game');
const Bot=require('./bot');

class GameManager {
  constructor({store,kafka}) {
    this.waiting=null; // username, timer
    this.games=new Map(); // gameId -> Game instance
    this.userToGame=new Map(); // username -> gameId
    this.store=store;
    this.kafka=kafka;
  }
  
    joinQueue(username) {
    // already in a game?
    if (this.userToGame.has(username)){
      const gameId=this.userToGame.get(username);
      const game=this.games.get(gameId);
      return {id:gameId,status:game ?game.status : 'matched'};
    }

    // If there is a waiting game for a different user -> attach this user to it (start match)
    if (this.waiting && this.waiting.username!==username) {
      const waitingGameId= this.waiting.gameId;

      //clearing the waiting timer immediately to avoid race with bot timer
      if (this.waiting.timer) {
        clearTimeout(this.waiting.timer);
      }
      this.waiting=null;

      const game=this.games.get(waitingGameId);
      if (!game){
        // fallback: creating a fresh waiting game for this user
        return this._createWaitingGame(username);
      }

      // If the waiting game currently has a bot attached (rare race), replace bot with real user
      if (game.player2 && typeof game.player2==='string' && game.player2.startsWith('BOT_')) {
        game.bot = null; //remove bot instance
      }

      // Attach second human player and move to ongoing
      game.player2=username;
      game.status='ongoing';
      this.userToGame.set(username,waitingGameId);

      // send authoritative state to both players
      game.broadcast({
        type:'state',
        board: game.board,
        turn:game.turn,
        status:game.status,
        players:{ player1: game.player1, player2: game.player2 },
        isBot: !!game.bot
      });

      this.kafka.emit('game_start',{
        gameId:waitingGameId,
        players:[game.player1, game.player2],
        bot:false,
        ts:new Date().toISOString()
      });

      return {id:waitingGameId,status:'ongoing' };
    }

    // No waiting opponent: create a waiting game for this username
    return this._createWaitingGame(username);
  }

  _createWaitingGame(username) {
    const gameId=uuidv4();
    const game=new Game({
      id:gameId,
      player1:username,
      player2:null,
      bot:null,
      store:this.store,
      kafka:this.kafka,
      manager:this
    });
    game.status='waiting';
    this.games.set(gameId, game);
    this.userToGame.set(username, gameId);

    // Set a timer that will attach a bot only if the waiting slot is STILL free.
    const timer=setTimeout(() => {
      // Only attach bot if this.waiting still refers to this game AND game has no player2
      if (!(this.waiting && this.waiting.gameId===gameId)) {
        // Waiting was cleared or replaced by a human — do nothing
        return;
      }

      const g=this.games.get(gameId);
      if (g && !g.player2) {
        // attach bot
        const bot=new Bot();
        g.player2='BOT_' + username;
        g.bot=bot;
        g.status='ongoing';

        // broadcast activated state
        g.broadcast({
          type:'state',
          board:g.board,
          turn:g.turn,
          status:g.status,
          players:{ player1: g.player1, player2: g.player2 },
          isBot: !!g.bot
        });

        this.kafka.emit('game_start',{
          gameId,
          players:[g.player1,g.player2],
          bot:true,
          ts:new Date().toISOString()
        });

        //If bot goes first (rare), have it move
        if (g.isBotTurn()) setTimeout(()=> g.makeBotMove(),150);
      }

      // clear waiting pointer
      if (this.waiting && this.waiting.gameId === gameId) this.waiting = null;
    }, 60000);

    // store waiting info (so joinQueue can clear the timer)
    this.waiting ={username,timer,gameId };
    return {id:gameId,status:'waiting' };
  }

  createGame(p1,p2,isBot) {
    // Keep this for backward compatibility if used elsewhere
    const gameId=uuidv4();
    const bot=isBot?new Bot():null;
    const game = new Game({id:gameId,player1:p1,player2:p2,bot,store:this.store,kafka:this.kafka,manager:this });
    this.games.set(gameId,game);
    this.userToGame.set(p1,gameId);
    if (p2) this.userToGame.set(p2,gameId);
    this.kafka.emit('game_start',{gameId,players:[p1,p2],bot:!!isBot,ts:new Date().toISOString()});
    return game;
  }
  handleWSConnection({ ws, gameId, username }) {
    // allow connect by gameId OR by username to rejoin
    let game =null;
    if (gameId && this.games.has(gameId)) game=this.games.get(gameId);
    else if (this.userToGame.has(username)) game=this.games.get(this.userToGame.get(username));

    if (!game) {
      ws.send(JSON.stringify({type:'error',message:'game not found. Join /match first.'}));
      ws.close();
      return;
    }

    game.attachWS(username,ws);
  }

  // Called by Game when complete to cleanup
  finishGame(gameId) {
    const game=this.games.get(gameId);
    if (!game) return;
    [game.player1,game.player2].forEach(u=>{
      if (this.userToGame.get(u)===gameId) this.userToGame.delete(u);
    });
    this.games.delete(gameId);
  }
}
module.exports = GameManager;