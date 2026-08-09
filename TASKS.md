# Task backlog (from user, this session)

✅ done · 🔨 in progress · ⏳ planned/deferred

## Bug fixes
- ✅ Card flip: won't break after quick/double taps — flip via onClick (reliable),
  swipe via element-scoped pointer capture (no leaked window listeners).
- ✅ Flashcard layout: title+counter on one line, actions wrap below (no crooked "1/N").
- ✅ Reader: quick-translate gloss popup dismisses on tap anywhere / scroll / Esc.
- ✅ 月→월 Korean misdetection: removed Korean from the auto-detect Han picker
  (only 中文 / 日本語 now; stored "ko" choice is ignored).
- ✅ Reader: warns when pasted text's script ≠ chosen source (offer swap / set source).
- ✅ Import word-list preview: enlarged word/meaning/example.
- ✅ Home "due today" cards: status label pinned to the card bottom (flex + mt-auto).

## Features
- ✅ Collection "Create «word»" (empty search) → opens add form in **AI/auto** mode,
  prefilled (`?word=&mode=auto`), auto-joining the set.
- ✅ Quiz counts toward "mastered" — verified: correct answers grade Good → reviewCount++.
- ✅ Unit economics — see `UNIT_ECONOMICS.md` (≈$0.2–2 / user / month; compute is free).
- ✅ AI tutor that can DO things (tool-use):
  - ✅ add synonyms/antonyms to the current card from chat (one-tap).
  - ✅ create new cards from chat ("add the word X") → background batch-add.
  - ✅ **Global tutor**: floating ✨ button on every page → chat panel with visible
    quick-actions (words by topic/level, explain), can create cards into a chosen
    collection, uses the current language pair.
- 🔨 Printable PNG cards:
  - ✅ prettier two-face (front + back) PNG, choose what's on each side (reuses the
    card layout), live preview + download — `PrintCardModal` + `renderPrintableCard`.
  - ⏳ user image on the card front (needs `Word.imageUrl` + upload/storage). Deferred.

## Wrap-up
- ✅ Commit to `new_lexa` (PR to main deferred per user).
