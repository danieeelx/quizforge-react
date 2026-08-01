# QuizForge v2.6 — Streamlined UI cleanup

## Removed

- Quick A–H answer buttons from the question sidebar
- Optional manual-question label field
- Decorative drag handles that did not support dragging
- AI promo card from the sidebar
- Hard-coded local profile card
- Import-complete modal after the import review
- Automatically inserted demo study set
- Duplicate manual-builder Add Question buttons
- Misleading bulk “Check answers” action
- Complete filter and full status legend from the exam navigator
- ServiceNow-specific automatic topic classification
- OCR toggle and image upload controls while OCR is not actually bundled
- AI controls and messaging when no AI backend is configured

## Improved

- One clear Create Study Set action on the dashboard
- Manual questions now use an accordion: opening one collapses the others
- Adding a question collapses the current question and opens the new one
- Collapsed questions show their text, number of choices, correct-answer count, and completion state
- Import review opens on questions that need attention
- Clean imported questions stay inside a collapsed review group
- Exam navigator now uses only All, Unanswered, Flagged, and conditional Incomplete filters
- Mobile exam navigator is a slide-out drawer
- Explanation setting only appears when explanations exist
- Imported questions use the generic General topic unless the user assigns one
- Empty library screen replaces the automatic sample set

## Verification

- TypeScript check passed
- Production build passed
- Parser smoke test passed
- The 80-question reference extraction still produces 80 questions, 80 answer keys, and no merged A–U choice lists
