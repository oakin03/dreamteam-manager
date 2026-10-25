// Before a setup build: copies the Daily Quiz answers learned on this computer into
// src/main/assets/quiz-bank.json, so a fresh install already knows them.
const fs = require('fs');
const path = require('path');

const bundledFile = path.join(__dirname, '..', 'src', 'main', 'assets', 'quiz-bank.json');
const learnedFile = path.join(process.env.APPDATA || '', 'dreamteam-manager', 'DreamTeamAutomator', 'quiz-bank.json');
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

const bundled = read(bundledFile)?.questions || {};
const raw = read(learnedFile);
const learned = (raw?.value || raw)?.questions || {};
const questions = { ...bundled, ...learned };
fs.writeFileSync(bundledFile, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), questions }, null, 2) + '\n');
console.log(`[quiz-bundle] ${Object.keys(questions).length} question(s) in the bundled bank (${Object.keys(learned).length} learned here).`);
