# Session handoff — 2026-10-24

- Task: completed requested Mika mobile chat/keyboard motion fixes.
- `frontend/lib/chatViewport.ts` follows actual visual viewport height/pan
  locally for the sheet and /mika, bypassing predicted close/easing.
- `chatScroll.ts` keeps welcome at top, follows delayed pinyin/image growth
  only at the newest reply, and removes smooth scrolling when sending.
- `mobileNav.ts` ignores resize-driven scroll clamping before adjustment;
  keeps pinned conversations at bottom and older reading position stable.
- Checked MDN VisualViewport and Chrome keyboard viewport guidance.
- Passed backend `npx tsc --noEmit -p .` and final frontend `npx next build`
  in Docker; existing frontend warnings only.
- Passed `node frontend/scripts/check-chat-keyboard.mjs`: Russian WebKit
  phone/Reader, rendered-frame pan/resize, Done, rapid refocus, progressive
  resize, newest/older messages, close/reopen and full-page chat.
- Baseline pan lag ~100px; checked frames now within 2px. Screenshot inspected
  in ignored `.playwright-cli/chat-keyboard/`; throwaway local user deleted.
- Real iPhone keyboard/FPS remains a physical-device check.
- BACKLOG Done updated; no other item started. No landing changes.
- Preserved unrelated frontend/.env.example, h3.txt and p.out.
- Local frontend serves verified production build; backend bot stays disabled.
- No remaining implementation steps; physical-device verification noted above.
