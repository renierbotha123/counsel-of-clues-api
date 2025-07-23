const express = require('express');
const router = express.Router();
const pool = require('./db');
const fetch = require('node-fetch');

// POST /narratives/generate/:gameId/round/:round
router.post('/generate/:gameId/round/:round', async (req, res) => {
  const { gameId, round } = req.params;

  try {
    console.log(`🧠 [Narrative Generator] Triggered for game ${gameId}, round ${round}`);

    // Fetch all answers for this round
    const answersRes = await pool.query(
      'SELECT * FROM answers WHERE game_id = $1 AND round = $2',
      [gameId, round]
    );
    const answerData = answersRes.rows;

    if (answerData.length === 0) {
      return res.status(400).json({ error: 'No answers found for this round.' });
    }

    let fullNarrative = '';
    let clueMap = {};

    // Call the AI
    const aiRes = await fetch('http://192.168.0.240:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "mistral",
        prompt: `You are an AI mystery narrator. Create a short dramatic narrative summarizing the murder mystery round. At the end, provide clues in this exact format:\n\n{\n  "narrative": "the full story...",\n  "clues": [\n    { "player_id": 135, "clue": "..." },\n    { "player_id": 136, "clue": "..." }\n  ]\n}\n\nUse the answers:\n${JSON.stringify(answerData)}`
      })
    });

    const lines = (await aiRes.text()).split('\n').filter(Boolean);
    console.log('🧠 Raw AI response lines:', lines);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.narrative && parsed.clues) {
          console.log('✅ Parsed AI Narrative:', parsed.narrative);
          console.log('🕵️‍♂️ Parsed Clues:', parsed.clues);
          fullNarrative = parsed.narrative;
          for (const clueObj of parsed.clues) {
            clueMap[clueObj.player_id] = clueObj.clue;
          }
        }
      } catch (e) {
        console.warn('⚠️ JSON parse failed:', line);
      }
    }

    // Save narrative
    await pool.query(
      'INSERT INTO narratives (game_id, round, narrative, clue) VALUES ($1, $2, $3, $4)',
      [gameId, round, fullNarrative, 'summary']
    );
    console.log('💾 Saved narrative to DB.');

    // Save each clue to corresponding answer row
    for (const row of answerData) {
      const clue = clueMap[row.player_id] || '';
     await pool.query(`
  UPDATE answers SET clue = $1, narrative = $2
  WHERE game_id = $3 AND round = $4 AND player_id = $5
`, [clueText, narrativeText, gameId, round, playerId]);
      console.log(`🧩 Clue saved for player ${row.player_id}: ${clue}`);
    }

    return res.json({ status: 'narrative_saved', narrative: fullNarrative });

  } catch (err) {
    console.error('❌ Narrative generation error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
