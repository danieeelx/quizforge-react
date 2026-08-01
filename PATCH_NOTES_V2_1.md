# QuizForge v2.1 — Parser & Interaction Update

## Fixed PDF parsing

- Detects tightly formatted question numbers such as `12.What`, `12)Which`, and `Question 12:`.
- Preserves page boundaries when a question starts on one page and its choices continue on the next.
- Appends wrapped lines to the correct question or answer choice.
- Prevents missed question boundaries from becoming giant A–U answer lists.
- Caps parsed choices at A–H and displays a warning when the source looks suspicious.
- Compares the highest numbered question with the number actually extracted.
- Shows an animated import summary after processing.

## Correct-answer detection

- Detects answer labels rendered in red in compatible reviewer PDFs.
- Supports answer keys and `Answer: A` / `Correct Answer: B` formats.
- Supports multi-answer questions such as “Choose two” and “Choose three.”
- Keeps correct answers attached to their options when choices are shuffled.

## UI and UX improvements

- Animated page transitions and card entrances.
- Button press, hover, shine, and icon-pop effects.
- Animated answer selection and confirmation checks.
- More expressive processing animation.
- Import-complete pop-up with extracted and verified counts.
- Enhanced toast notifications.
- Confetti and score reveal on passing results.
- Reduced-motion accessibility support.

## Verified test

The parser was tested against `CSA Mock 1.pdf`:

- 80 numbered questions detected
- 80 questions extracted
- No question had more than 8 choices
- 80 colored correct answers detected in the color-enriched extraction
- 18 multi-answer questions recognized
