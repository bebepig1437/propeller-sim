export interface InterpolatedPose {
  position: [number, number, number];
  yawRad: number;
  scale: number;
}

export function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

export function angleLerpDeg(currentDeg: number, targetDeg: number, alpha: number): number {
  let deltaDeg = targetDeg - currentDeg;
  while (deltaDeg > 180) deltaDeg -= 360;
  while (deltaDeg < -180) deltaDeg += 360;
  return currentDeg + deltaDeg * alpha;
}

export function computeInterpolatedPose(
  previous: InterpolatedPose,
  current: InterpolatedPose,
  alpha: number
): InterpolatedPose {
  const clamped = Math.max(0, Math.min(1, alpha));
  return {
    position: [
      lerp(previous.position[0], current.position[0], clamped),
      lerp(previous.position[1], current.position[1], clamped),
      lerp(previous.position[2], current.position[2], clamped)
    ],
    yawRad: angleLerpDeg(previous.yawRad * (180 / Math.PI), current.yawRad * (180 / Math.PI), clamped) * (Math.PI / 180),
    scale: lerp(previous.scale, current.scale, clamped)
  };
}
