// answers.js
const express = require('express');
const router = express.Router();
const pool = require('./db');
const axios = require('axios');

// Submit an answer
router.post('/:gameId/:playerId/:round', async (req, res) => {
  const { gameId, playerId, round } = req.params;
  const { question, answer, type, selected_option } = req.body;

  try {
    // Save or update the answer
    await pool.query(
      `INSERT INTO answers (game_id, player_id, round, question, answer, type, selected_option)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (game_id, player_id, round) DO UPDATE
       SET question=EXCLUDED.question,
           answer=EXCLUDED.answer,
           type=EXCLUDED.type,
           selected_option=EXCLUDED.selected_option`,
      [gameId, playerId, round, question, answer || null, type || 'text', selected_option || null]
    );

    // Check if all players have answered
    const totalPlayersRes = await pool.query(
      'SELECT COUNT(*) FROM game_players WHERE game_id=$1',
      [gameId]
    );
    const totalPlayers = Number(totalPlayersRes.rows[0].count);

    const answeredRes = await pool.query(
      'SELECT COUNT(DISTINCT player_id) FROM answers WHERE game_id=$1 AND round=$2',
      [gameId, round]
    );
    const answered = Number(answeredRes.rows[0].count);

    console.log(`🟡 Waiting: ${answered}/${totalPlayers} players answered`);

    if (answered < totalPlayers) {
      return res.json({ status: 'waiting', answered, totalPlayers });
    }

    console.log('✅ All players answered. Generating narrative...');
    // Trigger narrative generation
    await axios.post(`http://localhost:3000/narratives/generate/${gameId}/round/${round}`);

    return res.json({ status: 'complete', answered, totalPlayers });
  } catch (err) {
    console.error('❌ Error saving answer:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
