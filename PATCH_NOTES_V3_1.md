# QuizForge v3.1

## UI and typography
- Uses Oxanium for interface chrome, headings, labels, navigation, and buttons.
- Uses Inter for questions, answers, explanations, source text, and other long-form study content.
- Applies a shared 8/16/24/32 spacing system and consistent 48px form controls.

## Autosave
- Shows Saving, Saved, and Offline — saved locally states in the app and exam headers.
- Exam recovery continues saving locally without flashing on every timer tick.

## Exam workflow
- Adds keyboard shortcuts for answers, navigation, flags, confidence, lifelines, and source pages.
- Adds Confident, Unsure, and Guessed confidence marking per question.
- Saves confidence and flag data with attempts.

## Source review
- Stores extracted PDF text by page for new imports.
- Adds View source controls in the question editor, exam, and answer review.
- Existing study sets created before v3.1 show a clear source-unavailable message.

## Backup and export
- Exports the complete local library as a QuizForge JSON backup.
- Restores full backups or single exported study sets.
- Exports individual study sets as QuizForge JSON or CSV.

## Results
- Adds All, Incorrect, Correct, Guessed, Unsure, Flagged, and No explanation filters.
- Adds Correct but guessed and Confident mistakes metrics.
- Adds retake actions for guessed and flagged questions.
