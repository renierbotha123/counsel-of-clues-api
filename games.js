const express = require('express');
const router = express.Router();
const pool = require('./db');

// Create a game
router.post('/', async (req, res) => {
  try {
    const { theme, created_by } = req.body;
    if (!theme) {
  return res.status(400).json({ error: 'theme is required.' });
}

    const result = await pool.query(
      'INSERT INTO games (theme, status, created_by) VALUES ($1, $2, $3) RETURNING *',
  [theme, 'waiting', created_by]
);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });

  }
});

// Get all games
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM games');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message, stack: err.stack });

  }
});


// Get game info
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });

  }
});

// Assign roles to players in a game
router.post('/:id/assign-roles', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const gameId = req.params.id;

    // Get all players
    const result = await client.query(
      'SELECT * FROM game_players WHERE game_id = $1',
      [gameId]
    );

    const players = result.rows;

    if (players.length < 3) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'At least 3 players are needed to assign roles.' });
    }

    // Shuffle
    players.sort(() => Math.random() - 0.5);

    // Assign roles
    const assignments = players.map((player, index) => {
      let role = 'Guest';
      if (index === 0) role = 'Murderer';
      else if (index === 1) role = 'Detective';
      return { ...player, role };
    });

    // Update DB
    for (const p of assignments) {
      await client.query(
        'UPDATE game_players SET role = $1 WHERE id = $2',
        [p.role, p.id]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Roles assigned!', assignments });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message, stack: err.stack });
  } finally {
    client.release();
  }
});

// Update game status
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, created_by } = req.body;

    if (created_by) {
      await pool.query(
        'UPDATE games SET status = $1, created_by = $2 WHERE id = $3',
        [status, created_by, id]
      );
    } else {
      await pool.query(
        'UPDATE games SET status = $1 WHERE id = $2',
        [status, id]
      );
    }

    res.json({ message: 'Game status updated successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// Start game: only admin can trigger, assigns roles if needed
router.post('/:id/start', async (req, res) => {
  const client = await pool.connect();
  try {
    const gameId = req.params.id;
    const { playerId } = req.body; // Add this in the request from frontend

   // 0. Check if this player is the admin (creator of the game)
const adminRes = await client.query(
  'SELECT created_by FROM games WHERE id = $1',
  [gameId]
);

const adminId = adminRes.rows[0]?.created_by;

if (parseInt(playerId) !== adminId) {
  return res.status(403).json({ error: 'Only the game creator can start the game.' });
}


    // 1. Get all players
    const playersRes = await client.query(
      'SELECT * FROM game_players WHERE game_id = $1',
      [gameId]
    );
    const players = playersRes.rows;

    const rolesAlreadyAssigned = players.every(p => p.role);

    if (!rolesAlreadyAssigned) {
      players.sort(() => Math.random() - 0.5);

      const assignments = players.map((player, index) => {
        let role = 'Guest';
        if (index === 0) role = 'Murderer';
        else if (index === 1) role = 'Detective';
        return { ...player, role };
      });

      for (const p of assignments) {
        await client.query(
          'UPDATE game_players SET role = $1 WHERE id = $2',
          [p.role, p.id]
        );
      }
    }

   // 2. Set game status to in-progress and round = 1
await client.query(
  'UPDATE games SET status = $1, round = 1 WHERE id = $2',
  ['in-progress', gameId]
);

// 🧠 Trigger question generation using Ollama
const axios = require('axios');
await axios.post(`http://localhost:3000/questions/generate/${gameId}/round/1`);


    res.json({ message: 'Game started and roles assigned (if needed).' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Get the current round for a game
router.get('/:gameId/current-round', async (req, res) => {
  const { gameId } = req.params;

  try {
    const result = await pool.query(
      'SELECT round FROM games WHERE id = $1',
      [gameId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const round = result.rows[0].round;
    res.json({ round });
  } catch (error) {
    console.error('❌ Error fetching current round:', error);
    res.status(500).json({ error: 'Failed to get current round' });
  }
});






module.exports = router;

