const express = require('express');
const router = express.Router();
const pool = require('./db');

// Add player to game
router.post('/', async (req, res) => {
  try {
    const { game_id, player_name } = req.body;
    if (!game_id || !player_name) {
      return res.status(400).json({ error: 'game_id and player_name are required.' });
    }
    const result = await pool.query(
      'INSERT INTO game_players (game_id, player_name) VALUES ($1, $2) RETURNING *',
      [game_id, player_name]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message, stack: err.stack });

  }
});

// List players for a specific game
router.get('/game/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    const result = await pool.query(
      'SELECT * FROM game_players WHERE game_id = $1',
      [gameId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message, stack: err.stack });

  }
});

// Get a single player by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM game_players WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message, stack: err.stack });

  }
});

// Update player who called for a vote information
router.patch('/:id/vote-caller', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      'UPDATE game_players SET vote_caller = TRUE WHERE id = $1',
      [id]
    );
    res.json({ message: 'Vote caller set' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear vote caller status for all players in a game
router.patch('/game/:gameId/clear-vote-callers', async (req, res) => {
  try {
    const { gameId } = req.params;
    await pool.query(
      'UPDATE game_players SET vote_caller = FALSE WHERE game_id = $1',
      [gameId]
    );
    res.json({ message: 'Vote callers cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Penalize a player for a specific round
router.patch('/:id/penalize', async (req, res) => {
  try {
    const { id } = req.params;
    const { round } = req.body;
    await pool.query(
      'UPDATE game_players SET penalized_round = $1 WHERE id = $2',
      [round, id]
    );
    res.json({ message: `Player penalized for round ${round}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




module.exports = router;
