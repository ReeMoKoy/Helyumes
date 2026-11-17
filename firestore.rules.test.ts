import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rulesContent = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

test('firestore.rules contains global default-deny and verified identity gates', () => {
  assert.match(rulesContent, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
  assert.match(rulesContent, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesContent, /isValidId\(/);
  assert.match(rulesContent, /isValidUserProfile\(/);
  assert.match(rulesContent, /isValidConversation\(/);
  assert.match(rulesContent, /isValidChatMessage\(/);
  assert.match(rulesContent, /affectedKeys\(\)\.hasOnly\(/);
  assert.match(rulesContent, /existing\(\)\.userId == request\.auth\.uid/);
  assert.match(rulesContent, /'helyume-crush'/);
  assert.match(rulesContent, /'helyume-aura'/);
  assert.match(rulesContent, /'helyume-void'/);
});
