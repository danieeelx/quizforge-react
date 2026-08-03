import assert from "node:assert/strict";
import { parseQuestionBankDetailed } from "../dist/lib/parser.js";

const input = `
[[PAGE 1]]
1.What is 2 + 2?
A. 3
[[CORRECT]] B. 4
C. 5
D. 6
2)Which items are colors? (Choose two.)
[[CORRECT]] A. Red
B. Table
[[CORRECT]] C. Blue
D. Chair
[[PAGE 2]]
3. What continues across a page?
A. This question
B. This answer wraps
onto another extracted line
[[CORRECT]] C. Page-aware parsing
D. Nothing
`;

const result = parseQuestionBankDetailed(input);
assert.equal(result.questions.length, 3);
assert.equal(result.highestQuestionNumber, 3);
assert.equal(result.verifiedAnswers, 3);
assert.equal(result.questions[1].correctOptionIds.length, 2);
assert.equal(result.questions[1].selectionMode, "multiple");
assert.equal(result.questions[2].options[1].text, "This answer wraps onto another extracted line");
assert.ok(result.questions.every((question) => question.options.length <= 8));
console.log("Parser smoke test passed.");
