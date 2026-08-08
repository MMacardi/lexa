# Lexa — Ideas & Roadmap

Living backlog of cool ideas. Add here whenever something interesting comes up.
Status: ✅ done · 🔨 building · ⏭ approved/next · 💡 idea · 🧊 later

---

## Done
- ✅ **Cloze cards from examples** — Quiz has a "Fill the blank" mode: the target
  word is hidden in its example sentence, learner types it. (RemNote-inspired #1)
- ✅ **AI "Explain / when to use"** — word page button: nuance, register, synonym
  differences, common mistakes, in the learner's own language. On-demand (#2)

## Approved — next up
- ⏭ **Switch SRS to FSRS** (via `ts-fsrs`), 4 grades **Again / Hard / Good / Easy**
  (Anki's current default), target retention ~90%. Keep swipe as quick Again/Good.
  Needs per-card state (stability, difficulty, due, reps, lapses, state, lastReview).
  Scheduling itself costs **zero AI tokens** (pure math).

## Backlog — from RemNote analysis
- 💡 **#3 In-context reader** — paste an article/text → tap unknown words → card.
  Note: harder for Chinese (no spaces → needs word segmentation). Latin langs first.
- 💡 **#4 Mixed practice session** — interleave recognition + cloze + typing in one run.
- 💡 **#5 Clickable word links** — make synonyms/antonyms tappable → mini word-family graph.

## AI-enhanced review (opt-in — costs tokens, toggle it)
- 💡 **Fresh example each review** — new sentence per repetition (no rote memorizing one line).
- 💡 **AI-graded free recall** — learner writes a free answer, AI judges it (not just self-grade).
- 💡 **Difficulty adaptation** — tune example difficulty to performance.
  → All three behind a per-user toggle (default off) to control token spend.

## Smaller wins
- 💡 **Cache AI explanation** on the card (avoid re-spending tokens on re-open).
- 💡 **Quiz hotkeys** — 1–4 to pick answers, Enter/Space to continue.
- 💡 **Reader for CJK** — integrate a segmenter (e.g. jieba-style) so #3 works for Chinese.
