class Bot {
  constructor() {}

  // board: 6x7 array, botId & oppId are 1/2
  chooseMove(board, botId, oppId) {
    const validCols = [];
    for (let c = 0; c < 7; c++) {
      if (board[0][c] === 0) validCols.push(c);
    }

//helper to simulate drop on a copy
    const simulateDrop =(b,col, player)=>{
      const nb =b.map(r=>r.slice());
      for (let r=5;r>=0;r--){
        if (nb[r][col] ===0) {nb[r][col] =player; return { nb, row: r }; }
      }
      return null;};

  // helper win check used same as in game
    const checkWinAt = (b, r, c) => {
      const pid = b[r][c];
      if (!pid) return false;
      const dirs = [[[0,1],[0,-1]], [[1,0],[-1,0]], [[1,1],[-1,-1]], [[1,-1],[-1,1]]];
      for (const dir of dirs) {
        let cnt =1;
        for (const [dr, dc] of dir) {
          let rr =r+dr,cc=c+dc;
          while(rr>=0 && rr<6 && cc>=0 && cc<7 && b[rr][cc]===pid) {cnt++; rr+=dr; cc+=dc; }
        }
        if (cnt>=4) return true;
      }
      return false;
    };

    //case-immediate win
    for (const c of validCols) {
      const sim= simulateDrop(board, c, botId);
      if (!sim) continue;
      if (checkWinAt(sim.nb,sim.row,c)) return c;
    }

    //case-block opponent immediate win
    for (const c of validCols) {
      const sim= simulateDrop(board, c, oppId);
      if (!sim) continue;
      if (checkWinAt(sim.nb,sim.row,c)) return c;
    }

    // heuristic scoring
    const center= 3;
    let best=validCols[0];
    let bestScore=-1e9;

    for (const c of validCols) {
      const sim=simulateDrop(board,c,botId);
      if (!sim) continue;
      let score=0;
      //prefer center
      score+= 10-Math.abs(center- c);

      //counting consecutive tokens around placed position for bot
      for (const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
        let count =1;
        //forward
        let rr =sim.row +dr,cc=c+dc;
        while (rr>=0 && rr<6 && cc>=0 && cc<7 && sim.nb[rr][cc]===botId) {count++; rr+=dr;cc+=dc; }
        // backward
        rr= sim.row-dr; cc =c-dc;
        while (rr>=0 && rr<6 && cc>=0 && cc<7 && sim.nb[rr][cc]===botId) {count++;rr-=dr;cc-=dc; }
        score+= count*5;
      }

      // avoid moves that allow opponent immediate win next move (lookahead 1)
      let allowsOppWin= false;
      const boardAfter= sim.nb;
      for (let oc=0;oc<7;oc++) {
        // find top cell free
        if (boardAfter[0][oc]!==0) continue;
        const s2=simulateDrop(boardAfter,oc,oppId);
        if (!s2) continue;
        if (checkWinAt(s2.nb,s2.row,oc)) {allowsOppWin=true; break; }
      }
      if (allowsOppWin) score -= 1000;

      if (score>bestScore) {bestScore=score;best=c;}
    }
    return best;
  }
}

module.exports = Bot;