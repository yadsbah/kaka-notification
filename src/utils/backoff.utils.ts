// attempt = attempts already made (1 after the first failure). Past the end of the schedule the last step repeats.
// ±20% jitter so a burst of failures doesn't retry in lockstep; Retry-After wins when it asks for longer.
export const retryDelayMs = (
  attempt: number,
  scheduleSeconds: number[],
  retryAfterSeconds?: number,
  random: () => number = Math.random
) => {
  const step = Math.min(Math.max(attempt, 1), scheduleSeconds.length) - 1;
  const jittered = scheduleSeconds[step]! * 1000 * (0.8 + random() * 0.4);
  return Math.round(Math.max(jittered, (retryAfterSeconds ?? 0) * 1000));
};
