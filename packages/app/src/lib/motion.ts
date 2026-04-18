import type { Transition, Variants } from "motion/react";

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_CRISP = [0.26, 0.08, 0.25, 1] as const;

export const HOUSE_TRANSITION: Transition = {
  type: "spring",
  duration: 0.35,
  bounce: 0.12,
};

export const TWEEN_FAST: Transition = {
  duration: 0.2,
  ease: EASE_OUT,
};

export const TWEEN_SLOW: Transition = {
  duration: 0.6,
  ease: EASE_OUT,
};

export const BLUR_REVEAL: Variants = {
  hidden: { opacity: 0, y: 8, filter: "blur(6px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.5, ease: EASE_OUT },
  },
};

export const STAGGER_CONTAINER: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.08 },
  },
};

export const ROW_ITEM: Variants = {
  hidden: { opacity: 0, x: -8, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: { duration: 0.35, ease: EASE_OUT },
  },
};

// Direction-aware step variants for the buy wizard
export const stepVariants: Variants = {
  enter: (dir: number) => ({
    opacity: 0,
    x: dir > 0 ? 24 : -24,
  }),
  center: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.28, ease: EASE_OUT },
  },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir > 0 ? -24 : 24,
    transition: { duration: 0.18, ease: EASE_OUT },
  }),
};
