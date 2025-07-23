const express = require('express');
const router = express.Router();
const db = require('./db'); // ✅ Correct relative path

router.post('/reset-game/:gameId', async (req, res) => {
  const { gameId } = req.params;

  try {
    await pool.query('DELETE FROM answers WHERE game_id = $1', [gameId]);
    await pool.query('DELETE FROM narratives WHERE game_id = $1', [gameId]);
    await pool.query('UPDATE game_players SET vote_caller = false, penalized_round = null WHERE game_id = $1', [gameId]);
    res.json({ status: 'reset' });
  } catch (err) {
    console.error('❌ Failed to reset game:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
