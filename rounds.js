const express = require('express');
const router = express.Router();
const pool = require('./db');
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

router.post('/advance/:gameId', async (req, res) => {
  const { gameId } = req.params;

  const client = await pool.connect();

  try {
    // Get current round
    const gameRes = await client.query('SELECT round FROM games WHERE id = $1', [gameId]);
    const currentRound = gameRes.rows[0]?.round || 0;
    const newRound = currentRound + 1;

    // Update round in DB
    await client.query('UPDATE games SET round = $1 WHERE id = $2', [newRound, gameId]);

    // Generate narrative
    await axios.post(`${BASE_URL}/narratives/generate/${gameId}/round/${newRound}`);

    // Generate questions
    await axios.post(`${BASE_URL}/questions/generate/${gameId}/round/${newRound}`);

    res.json({ round: newRound, status: 'success' });
  } catch (err) {
    console.error('❌ Error advancing round:', err);
    res.status(500).json({ error: 'Failed to advance round.', details: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
