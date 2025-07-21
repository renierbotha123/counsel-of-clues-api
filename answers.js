const express = require('express');
const router = express.Router();
const pool = require('./db');
const fetch = require('node-fetch'); // Ensure you installed: npm install node-fetch@2

// Helper to assign clues per player
function extractCluesPerPlayer(narrative, answerData) {
  const clueMap = {};
  for (const row of answerData) {
    const regex = new RegExp(`Clue for Player ${row.player_id}:\\s*(.*)`, 'i');
    const match = narrative.match(regex);
    clueMap[row.player_id] = match ? match[1].trim() : '';
  }
  return clueMap;
}



// Submit an answer
router.post('/:gameId/:playerId/:round', async (req, res) => {
  const { gameId, playerId, round } = req.params;
  const { question, answer, type, selected_option } = req.body;

  try {
    // 1. Save or update answer
    await pool.query(`
      INSERT INTO answers (game_id, player_id, round, question, answer, type, selected_option)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (game_id, player_id, round)
      DO UPDATE SET question=EXCLUDED.question, answer=EXCLUDED.answer, type=EXCLUDED.type, selected_option=EXCLUDED.selected_option
    `, [gameId, playerId, parseInt(round), question, answer, type, selected_option]);

    // 2. Check if all players have answered
    const tot = await pool.query('SELECT COUNT(*) FROM game_players WHERE game_id=$1', [gameId]);
    const answered = await pool.query('SELECT COUNT(DISTINCT player_id) FROM answers WHERE game_id=$1 AND round=$2', [gameId, round]);
    const totalPlayers = parseInt(tot.rows[0].count, 10);
    const answeredCount = parseInt(answered.rows[0].count, 10);
    console.log(`🔎 Answer check: ${answeredCount}/${totalPlayers} for game ${gameId} round ${round}`);

    if (answeredCount < totalPlayers) {
      console.log(`🟡 Waiting: ${answeredCount}/${totalPlayers} players answered.`);
      return res.json({ status: 'waiting' });
    }

    console.log(`✅ All players answered. Calling AI...`);

    // 3. Get all answers
    const allAnswers = await pool.query(
      'SELECT * FROM answers WHERE game_id = $1 AND round = $2',
      [gameId, round]
    );
    const answerData = allAnswers.rows;

    // 4. Call AI (streaming response from Ollama)
   let fullNarrative = '';
try {
  const aiRes = await fetch('http://192.168.0.240:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "mistral",
      prompt: `Summarize this round as a dramatic murder mystery. After the story, list one clue per player like this:\n\nClue for Player 128: ...\nClue for Player 129: ...\n\nAnswers:\n${JSON.stringify(answerData)}`

    })
  });

  const lines = (await aiRes.text()).split('\n').filter(line => line.trim() !== '');
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      fullNarrative += parsed.response || '';
    } catch (e) {
      console.warn('⚠️ Could not parse line:', line);
    }
  }

  console.log("🧠 Final full narrative:", fullNarrative);
} catch (e) {
  console.error("❌ AI fetch failed:", e.message);
}


    // 5. Extract clues and save narrative
    const clueMap = extractCluesPerPlayer(fullNarrative, answerData);

    await pool.query(
      'INSERT INTO narratives (game_id, round, narrative, clue) VALUES ($1, $2, $3, $4)',
      [gameId, round, fullNarrative, 'summary']
    );

    // 6. Update clues for each player
    for (const row of answerData) {
      const clue = clueMap[row.player_id] || '';
      await pool.query(
        'UPDATE answers SET clue = $1 WHERE game_id = $2 AND round = $3 AND player_id = $4',
        [clue, gameId, round, row.player_id]
      );
    }

    console.log("✅ Narrative and clues saved.");
    res.json({ status: 'complete' });

  } catch (err) {
    console.error('❌ Error saving answer or generating narrative:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET a player's clue and narrative for a round
router.get('/:gameId/:playerId/:round', async (req, res) => {
  const { gameId, playerId, round } = req.params;

  try {
    // 1. Get the player's clue
    const clueRes = await pool.query(
      'SELECT clue FROM answers WHERE game_id = $1 AND player_id = $2 AND round = $3',
      [gameId, playerId, round]
    );
    const clue = clueRes.rows[0]?.clue || '';

    // 2. Get the shared narrative
    const narrativeRes = await pool.query(
      'SELECT narrative FROM narratives WHERE game_id = $1 AND round = $2',
      [gameId, round]
    );
    const narrative = narrativeRes.rows[0]?.narrative || '';

    res.json({ clue, narrative });
  } catch (err) {
    console.error('❌ Error fetching narrative or clue:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
