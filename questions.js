const express = require('express');
const router = express.Router();
const pool = require('./db');
const axios = require('axios');

// POST /questions/generate/:gameId/round/:round
router.post('/generate/:gameId/round/:round', async (req, res) => {
  const { gameId, round } = req.params;

  try {
    console.log(`\n🔵 Generating questions for game ${gameId}, round ${round}`);

    // 1. Load context for the AI prompt
    const [gameRes, answersRes, storyRes, cluesRes, playersRes] = await Promise.all([
      pool.query('SELECT theme FROM games WHERE id = $1', [gameId]),
      pool.query(`
        SELECT gp.player_name, a.answer 
        FROM answers a
        JOIN game_players gp ON a.player_id = gp.id
        WHERE a.game_id = $1 AND a.round = $2
      `, [gameId, round]),
      pool.query('SELECT narrative FROM narratives WHERE game_id = $1 ORDER BY round', [gameId]),
      pool.query('SELECT clue FROM narratives WHERE game_id = $1 ORDER BY round', [gameId]),
      pool.query('SELECT id, player_name FROM game_players WHERE game_id = $1', [gameId])
    ]);

    const theme = gameRes.rows[0]?.theme || 'mystery';
    const storySoFar = storyRes.rows.map(row => row.narrative).join('\n');
    const clues = cluesRes.rows.map(row => `- ${row.clue}`).join('\n');
    const answerSummary = answersRes.rows.map(r => `${r.player_name}: ${r.answer}`).join('\n');
    const players = playersRes.rows;

    // 2. Prompt the AI to generate questions for each player
    const aiPrompt = `
You are the game master of a murder mystery party.

Generate 1 immersive, personal question for each player listed below.
You must return a valid JSON array. Do not explain anything.
The array must include exactly one object per player.

Each object must include:
{
  "player_id": <number>,
  "question": "<string>",
  "type": "<'text' or 'multiple_choice' or 'abcd'>",
  "options": ["A", "B", "C", "D"], // Required if type is not 'text'
  "clue": "<string>" // A secret clue only this player sees
}

Rules:
- If type is 'text', omit the 'options' field.
- If type is 'multiple_choice' or 'abcd', include 'options' (must be a non-empty array).
- Clue must always be included.
- Use JSON formatting only — no explanations or extra text.
- Stay in character and make the clue relevant to the story.

Theme: ${theme}
Round: ${round}

Story so far:
${storySoFar || 'None yet.'}

Clues so far:
${clues || 'None yet.'}

Previous answers:
${answerSummary || 'None yet.'}

Players:
${players.map(p => `${p.id}: ${p.player_name}`).join('\n')}
`.trim();

    console.log('🔵 Prompt sent to AI:\n', aiPrompt);

    const ollamaRes = await axios.post('http://192.168.0.240:11434/api/generate', {
      model: 'mistral:latest',
      prompt: aiPrompt,
      stream: false
    });
    console.log('\n🟡 Raw AI Response:\n', ollamaRes.data.response);

    let questions;
    try {
      questions = JSON.parse(ollamaRes.data.response);

      if (!Array.isArray(questions) || questions.length === 0) {
        console.warn('⚠ AI returned empty or invalid question array:', ollamaRes.data.response);
        return res.status(400).json({ error: 'AI returned no questions', raw: ollamaRes.data.response });
      }

    } catch (err) {
      console.error('❌ Failed to parse AI response as JSON:', ollamaRes.data.response);
      return res.status(500).json({ error: 'Invalid AI response format', raw: ollamaRes.data.response });
    }

    // 3. Save each question to the DB
    for (const player of players) {
      const playerId = player.id;
      const questionObj = questions.find(q => q.player_id === playerId);

      if (!questionObj) {
        console.warn(`⚠ No question found for player ${playerId}`);
        continue;
      }

      if (
        questionObj.type === 'multiple_choice' || questionObj.type === 'abcd'
      ) {
        if (!Array.isArray(questionObj.options) || questionObj.options.length === 0) {
          console.warn(`⚠ Invalid or missing options for player ${playerId}, skipping.`);
          continue;
        }
      }

     // 🔒 Defensive check for multiple choice types
if (questionObj.type === 'multiple_choice' || questionObj.type === 'abcd') {
  if (!Array.isArray(questionObj.options) || questionObj.options.length === 0) {
    console.warn(`⚠ Invalid or missing options for player ${playerId}, skipping.`);
    continue;
  }
}

// ✅ Format options: only use array, otherwise null
const safeOptions =
  Array.isArray(questionObj.options) && questionObj.options.length > 0
    ? JSON.stringify(questionObj.options)
    : null;

// ✅ Insert into DB
await pool.query(
  'INSERT INTO questions (game_id, player_id, question, type, options, round) VALUES ($1, $2, $3, $4, $5::jsonb, $6)',
  [
    gameId,
    playerId,
    questionObj.question,
    questionObj.type || 'text',
    safeOptions,
    round,
  ]
);

    }

    return res.json({ message: 'Questions saved successfully!' });
  } catch (err) {
    console.error('❌ Error generating questions:', err);
    return res.status(500).json({ error: 'Failed to generate questions', details: err.message });
  }
});

// GET /questions/game/:gameId/player/:playerId?round=1
router.get('/game/:gameId/player/:playerId', async (req, res) => {
  const { gameId, playerId } = req.params;
  const { round } = req.query;

  try {
    const result = await pool.query(
      'SELECT * FROM questions WHERE game_id = $1 AND player_id = $2 AND round = $3',
      [gameId, playerId, round]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching questions:', err);
    res.status(500).json({ error: 'Failed to fetch questions', details: err.message });
  }
});

module.exports = router;