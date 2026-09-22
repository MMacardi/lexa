"use client";

import { useEffect, useRef, useState } from "react";

// A finger-driven drag (a sheet pulled down, a flashcard swiped) painted from a
// smoothed copy of the finger's position, once per screen frame.
//
// Painting each touch move as it came made a slow, careful drag judder while a
// quick one looked fine. iOS reports the finger in whole CSS pixels (three
// screen pixels on an iPhone) and not in step with the screen's frames, so a
// creeping thumb moved the card a pixel, then nothing, then two. This follows
// the finger through a speed-dependent low-pass (a One Euro filter): strong
// while the finger creeps, where a pixel of lag can't be seen but a step can,
// and next to none when it moves fast, where lag would show and steps don't.
const MIN_CUTOFF = 3; // Hz, at rest
const BETA = 0.03; // extra Hz per px/s of speed
const SPEED_CUTOFF = 3; // Hz, for the speed estimate itself

export type Follower = {
  /** Start following with the element (and the finger) at x, y. */
  start: (x: number, y: number) => void;
  /** Where the finger puts the element now. */
  to: (x: number, y: number) => void;
  /** Stop following; returns where the element was last painted. */
  stop: () => { x: number; y: number };
};

const alpha = (hz: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * hz * dt));

export function dragFollower(paint: (x: number, y: number) => void): Follower {
  let tx = 0;
  let ty = 0;
  let x = 0;
  let y = 0;
  let speed = 0; // px/s
  let last = 0;
  let frame = 0;

  const step = (now: number) => {
    const dt = Math.min(0.05, Math.max(0.004, last ? (now - last) / 1000 : 1 / 60));
    last = now;
    // How fast the shown position would have to move to reach the finger: it
    // grows while the element trails behind, so a speed-up catches up at once.
    speed += alpha(SPEED_CUTOFF, dt) * (Math.hypot(tx - x, ty - y) / dt - speed);
    const a = alpha(MIN_CUTOFF + BETA * speed, dt);
    const nx = x + a * (tx - x);
    const ny = y + a * (ty - y);
    if (Math.abs(nx - x) > 0.01 || Math.abs(ny - y) > 0.01) {
      x = nx;
      y = ny;
      paint(x, y);
    }
    frame = requestAnimationFrame(step);
  };

  return {
    start(x0, y0) {
      cancelAnimationFrame(frame);
      x = tx = x0;
      y = ty = y0;
      speed = 0;
      last = 0;
      frame = requestAnimationFrame(step);
    },
    to(nx, ny) {
      tx = nx;
      ty = ny;
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      return { x, y };
    },
  };
}

/** A follower for a component; `paint` may change between renders. */
export function useDragFollower(paint: (x: number, y: number) => void) {
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const [follower] = useState(() => dragFollower((x, y) => paintRef.current(x, y)));
  useEffect(() => () => void follower.stop(), [follower]);
  return follower;
}
