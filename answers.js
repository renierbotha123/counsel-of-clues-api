const express = require('express');
const router = express.Router();
const pool = require('./db');
const axios = require('axios');

// Submit an answer
router.post('/:gameId/:playerId/:round', async (req, res) => {
  const { gameId, playerId, round } = req.params;
  const { question, answer, type, selected_option } = req.body;

  try {
    // 1. Insert or update answer
    await pool.query(`
      INSERT INTO answers (game_id, player_id, round, question, answer, type, selected_option)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (game_id, player_id, round)
      DO UPDATE SET question=EXCLUDED.question, answer=EXCLUDED.answer, type=EXCLUDED.type, selected_option=EXCLUDED.selected_option
    `, [gameId, playerId, parseInt(round), question, answer, type, selected_option]);

    // 2. Count players & answered players
    const tot = await pool.query('SELECT COUNT(*) FROM game_players WHERE game_id=$1', [gameId]);
    const answered = await pool.query('SELECT COUNT(DISTINCT player_id) FROM answers WHERE game_id=$1 AND round=$2', [gameId, round]);
    const totalPlayers = parseInt(tot.rows[0].count,10);
    const answeredCount = parseInt(answered.rows[0].count,10);

    if (answeredCount < totalPlayers) {
      console.log(`🟡 Waiting: ${answeredCount}/${totalPlayers} players answered.`);
      return res.json({ status: 'waiting', answered: answeredCount, total: totalPlayers });
    }

    console.log(`✅ All players answered. Triggering narrative.`);
    // 3. Trigger narrative generation
    await axios.post(`http://localhost:3000/narratives/generate/${gameId}/${round}`);
    res.json({ status: 'complete' });
  } catch(err) {
    console.error('❌ Error saving answer or generating narrative:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
