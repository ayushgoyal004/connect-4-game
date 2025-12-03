const {Pool}=require('pg');
require('dotenv').config(); 
class Store{
  constructor() {
    const connectionString=process.env.DATABASE_URL;
    this.pool=new Pool({connectionString});
  }

  async saveGame(game) {
    const q=`
      INSERT INTO games (id, created_at, duration_seconds, player1, player2, winner, moves, analytics)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `;
    await this.pool.query(q,[game.id,game.created_at,game.duration_seconds,game.player1,game.player2,game.winner,game.moves,game.analytics]);
  }
  async incWin(username) {
    const up =`
      INSERT INTO leaderboard (username, wins) VALUES ($1,1)
      ON CONFLICT (username) DO UPDATE SET wins = leaderboard.wins + 1
    `;
    await this.pool.query(up,[username]);
  }

  async getLeaderboard(limit=20) {
    const res=await this.pool.query('SELECT username, wins FROM leaderboard ORDER BY wins DESC LIMIT $1',[limit]);
    return res.rows;
  }

  async close() {await this.pool.end();}
}
module.exports = Store;