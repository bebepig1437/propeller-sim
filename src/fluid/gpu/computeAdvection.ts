import {
  Fn,
  instanceIndex,
  uniform,
  float,
  uint,
  clamp,
  add,
  sub,
  mul,
  min,
  max,
  storage
} from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';

export interface AdvectionNodeBuffers {
  u?: StorageBufferAttribute;
  v?: StorageBufferAttribute;
  source?: StorageBufferAttribute;
  target?: StorageBufferAttribute;
  phiStar?: StorageBufferAttribute;
  phiStarStar?: StorageBufferAttribute;
}

export function createAdvectionComputeNode(
  width: number,
  height: number,
  buffers?: AdvectionNodeBuffers
) {
  const size = width * height;
  const dtUniform = uniform(1.0 / 60.0);
  const invDxUniform = uniform(1.0);
  const widthUniform = uniform(width);
  const heightUniform = uniform(height);

  const uAttr = buffers?.u ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const vAttr = buffers?.v ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const srcAttr = buffers?.source ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const tgtAttr = buffers?.target ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const starAttr = buffers?.phiStar ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const starStarAttr = buffers?.phiStarStar ?? new StorageBufferAttribute(new Float32Array(size), 1);

  const uStorage = storage(uAttr, 'float', size);
  const vStorage = storage(vAttr, 'float', size);
  const srcStorage = storage(srcAttr, 'float', size);
  const tgtStorage = storage(tgtAttr, 'float', size);
  const starStorage = storage(starAttr, 'float', size);
  const starStarStorage = storage(starStarAttr, 'float', size);

  const sampleBilinear = Fn(([field, px, py, W, H]: [any, any, any, any, any]) => {
    const cx = clamp(px, float(0.5), sub(float(W), float(1.5)));
    const cy = clamp(py, float(0.5), sub(float(H), float(1.5)));
    const x0 = uint(cx);
    const y0 = uint(cy);
    const x1 = add(x0, uint(1));
    const y1 = add(y0, uint(1));

    const s1 = sub(cx, float(x0));
    const s0 = sub(float(1.0), s1);
    const t1 = sub(cy, float(y0));
    const t0 = sub(float(1.0), t1);

    const i00 = add(mul(y0, W), x0);
    const i10 = add(mul(y0, W), x1);
    const i01 = add(mul(y1, W), x0);
    const i11 = add(mul(y1, W), x1);

    const v00 = field.element(i00);
    const v10 = field.element(i10);
    const v01 = field.element(i01);
    const v11 = field.element(i11);

    return add(
      mul(t0, add(mul(s0, v00), mul(s1, v10))),
      mul(t1, add(mul(s0, v01), mul(s1, v11)))
    );
  });

  const forwardShader = Fn(() => {
    const idx = instanceIndex;
    const W = uint(width);
    const H = uint(height);
    const x = idx.remainder(W);
    const y = idx.div(W);

    const traceX = sub(float(x), mul(dtUniform, mul(uStorage.element(idx), invDxUniform)));
    const traceY = sub(float(y), mul(dtUniform, mul(vStorage.element(idx), invDxUniform)));

    starStorage.element(idx).assign(sampleBilinear(srcStorage, traceX, traceY, W, H));
  });

  const backwardShader = Fn(() => {
    const idx = instanceIndex;
    const W = uint(width);
    const H = uint(height);
    const x = idx.remainder(W);
    const y = idx.div(W);

    const traceX = add(float(x), mul(dtUniform, mul(uStorage.element(idx), invDxUniform)));
    const traceY = add(float(y), mul(dtUniform, mul(vStorage.element(idx), invDxUniform)));

    starStarStorage.element(idx).assign(sampleBilinear(starStorage, traceX, traceY, W, H));
  });

  const correctShader = Fn(() => {
    const idx = instanceIndex;
    const W = uint(width);
    const H = uint(height);
    const x = idx.remainder(W);
    const y = idx.div(W);

    const phiStarVal = starStorage.element(idx);
    const phiNVal = srcStorage.element(idx);
    const phiStarStarVal = starStarStorage.element(idx);
    const corrected = add(phiStarVal, mul(float(0.5), sub(phiNVal, phiStarStarVal)));

    const traceX = clamp(
      sub(float(x), mul(dtUniform, mul(uStorage.element(idx), invDxUniform))),
      float(0.5),
      sub(float(W), float(1.5))
    );
    const traceY = clamp(
      sub(float(y), mul(dtUniform, mul(vStorage.element(idx), invDxUniform))),
      float(0.5),
      sub(float(H), float(1.5))
    );

    const x0 = uint(traceX);
    const y0 = uint(traceY);
    const x1 = add(x0, uint(1));
    const y1 = add(y0, uint(1));

    const i00 = add(mul(y0, W), x0);
    const i10 = add(mul(y0, W), x1);
    const i01 = add(mul(y1, W), x0);
    const i11 = add(mul(y1, W), x1);

    const v00 = srcStorage.element(i00);
    const v10 = srcStorage.element(i10);
    const v01 = srcStorage.element(i01);
    const v11 = srcStorage.element(i11);

    const minNeighbor = min(min(v00, v10), min(v01, v11));
    const maxNeighbor = max(max(v00, v10), max(v01, v11));

    tgtStorage.element(idx).assign(clamp(corrected, minNeighbor, maxNeighbor));
  });

  const slShader = Fn(() => {
    const idx = instanceIndex;
    const W = uint(width);
    const H = uint(height);
    const x = idx.remainder(W);
    const y = idx.div(W);

    const traceX = sub(float(x), mul(dtUniform, mul(uStorage.element(idx), invDxUniform)));
    const traceY = sub(float(y), mul(dtUniform, mul(vStorage.element(idx), invDxUniform)));

    tgtStorage.element(idx).assign(sampleBilinear(srcStorage, traceX, traceY, W, H));
  });

  return {
    forwardNode: forwardShader().compute(size),
    backwardNode: backwardShader().compute(size),
    correctNode: correctShader().compute(size),
    semiLagrangianNode: slShader().compute(size),
    node: slShader().compute(size),
    dtUniform,
    invDxUniform,
    widthUniform,
    heightUniform,
    buffers: {
      uAttr,
      vAttr,
      srcAttr,
      tgtAttr,
      starAttr,
      starStarAttr
    }
  };
}
