# QuizForge v2.8 — UI Repair and Simplified Lifelines

## Fixed from the reported screenshots

- Rebuilt the lifeline controls so they no longer collapse or overlap the question content.
- Replaced four separate setup switches with one **Practice lifelines** master toggle.
- Replaced the permanently visible lifeline button row with one compact **Lifelines** menu.
- Added **Save & Home** during an exam. Leaving the exam saves answers, flags, timer, lifeline use, and the current question for later recovery.
- Increased exam spacing and made the question workspace more responsive at browser zoom and medium desktop widths.
- Changed the exam navigator into a drawer at widths up to 1100 px, preventing the content from being squeezed.
- Fixed the main sidebar spacing and turned the local-storage note into a separate readable status card.
- Replaced the disabled-looking gray Create Study Set card with a proper theme-aware surface.
- Removed a duplicated manual-question state update that could add the same new card twice.

## Verification

- TypeScript check passed.
- Production build passed.
- Parser smoke test passed.
- Static UI source checks passed for the master lifeline toggle, Lifelines menu, and Save & Home action.
