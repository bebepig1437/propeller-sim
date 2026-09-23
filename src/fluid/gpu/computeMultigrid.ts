import {
  Fn,
  instanceIndex,
  uniform,
  float,
  uint,
  add,
  sub,
  mul,
  div,
  clamp,
  storage
} from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';

export interface MultigridBuffers {
  fineP?: StorageBufferAttribute;
  finePNext?: StorageBufferAttribute;
  fineDiv?: StorageBufferAttribute;
  fineResidual?: StorageBufferAttribute;
  coarseR?: StorageBufferAttribute;
  coarseE?: StorageBufferAttribute;
  coarseENext?: StorageBufferAttribute;
}

export function createMultigridComputeNodes(
  fineWidth: number,
  fineHeight: number,
  buffers?: MultigridBuffers
) {
  const coarseWidth = Math.floor(fineWidth / 2);
  const coarseHeight = Math.floor(fineHeight / 2);

  const fineSize = fineWidth * fineHeight;
  const coarseSize = coarseWidth * coarseHeight;

  const finePAttr = buffers?.fineP ?? new StorageBufferAttribute(new Float32Array(fineSize), 1);
  const finePNextAttr = buffers?.finePNext ?? new StorageBufferAttribute(new Float32Array(fineSize), 1);
  const fineDivAttr = buffers?.fineDiv ?? new StorageBufferAttribute(new Float32Array(fineSize), 1);
  const fineResidualAttr = buffers?.fineResidual ?? new StorageBufferAttribute(new Float32Array(fineSize), 1);

  const coarseRAttr = buffers?.coarseR ?? new StorageBufferAttribute(new Float32Array(coarseSize), 1);
  const coarseEAttr = buffers?.coarseE ?? new StorageBufferAttribute(new Float32Array(coarseSize), 1);
  const coarseENextAttr = buffers?.coarseENext ?? new StorageBufferAttribute(new Float32Array(coarseSize), 1);

  const finePStorage = storage(finePAttr, 'float', fineSize);
  const fineDivStorage = storage(fineDivAttr, 'float', fineSize);
  const fineResidualStorage = storage(fineResidualAttr, 'float', fineSize);

  const coarseRStorage = storage(coarseRAttr, 'float', coarseSize);
  const coarseEStorage = storage(coarseEAttr, 'float', coarseSize);
  const coarseENextStorage = storage(coarseENextAttr, 'float', coarseSize);

  const dx2Uniform = uniform(1.0);
  const coarseDx2Uniform = uniform(4.0);

  const residualShader = Fn(() => {
    const idx = instanceIndex;
    const W = uint(fineWidth);
    const H = uint(fineHeight);
    const x = idx.remainder(W);
    const y = idx.div(W);

    const isInterior = x.greaterThan(uint(0)).and(x.lessThan(sub(W, uint(1))))
      .and(y.greaterThan(uint(0))).and(y.lessThan(sub(H, uint(1))));

    const xLeft = x.greaterThan(uint(0)).select(sub(x, uint(1)), x);
    const xRight = x.lessThan(sub(W, uint(1))).select(add(x, uint(1)), x);
    const yDown = y.greaterThan(uint(0)).select(sub(y, uint(1)), y);
    const yUp = y.lessThan(sub(H, uint(1))).select(add(y, uint(1)), y);

    const idxLeft = add(mul(y, W), xLeft);
    const idxRight = add(mul(y, W), xRight);
    const idxDown = add(mul(yDown, W), x);
    const idxUp = add(mul(yUp, W), x);

    const sumP = add(
      add(finePStorage.element(idxLeft), finePStorage.element(idxRight)),
      add(finePStorage.element(idxDown), finePStorage.element(idxUp))
    );

    const lapP = div(sub(sumP, mul(float(4.0), finePStorage.element(idx))), dx2Uniform);
    const res = sub(fineDivStorage.element(idx), lapP);

    fineResidualStorage.element(idx).assign(isInterior.select(res, float(0.0)));
  });

  const restrictShader = Fn(() => {
    const idx = instanceIndex;
    const cW = uint(coarseWidth);
    const fW = uint(fineWidth);
    const cx = idx.remainder(cW);
    const cy = idx.div(cW);

    const fx0 = mul(cx, uint(2));
    const fy0 = mul(cy, uint(2));
    const fx1 = add(fx0, uint(1));
    const fy1 = add(fy0, uint(1));

    const i00 = add(mul(fy0, fW), fx0);
    const i10 = add(mul(fy0, fW), fx1);
    const i01 = add(mul(fy1, fW), fx0);
    const i11 = add(mul(fy1, fW), fx1);

    const r00 = fineResidualStorage.element(i00);
    const r10 = fineResidualStorage.element(i10);
    const r01 = fineResidualStorage.element(i01);
    const r11 = fineResidualStorage.element(i11);

    const avg = mul(float(0.25), add(add(r00, r10), add(r01, r11)));
    coarseRStorage.element(idx).assign(avg);
    coarseEStorage.element(idx).assign(float(0.0));
  });

  const coarseJacobiShader = Fn(() => {
    const idx = instanceIndex;
    const cW = uint(coarseWidth);
    const cH = uint(coarseHeight);
    const x = idx.remainder(cW);
    const y = idx.div(cW);

    const isInterior = x.greaterThan(uint(0)).and(x.lessThan(sub(cW, uint(1))))
      .and(y.greaterThan(uint(0))).and(y.lessThan(sub(cH, uint(1))));

    const xLeft = x.greaterThan(uint(0)).select(sub(x, uint(1)), x);
    const xRight = x.lessThan(sub(cW, uint(1))).select(add(x, uint(1)), x);
    const yDown = y.greaterThan(uint(0)).select(sub(y, uint(1)), y);
    const yUp = y.lessThan(sub(cH, uint(1))).select(add(y, uint(1)), y);

    const idxLeft = add(mul(y, cW), xLeft);
    const idxRight = add(mul(y, cW), xRight);
    const idxDown = add(mul(yDown, cW), x);
    const idxUp = add(mul(yUp, cW), x);

    const sumE = add(
      add(coarseEStorage.element(idxLeft), coarseEStorage.element(idxRight)),
      add(coarseEStorage.element(idxDown), coarseEStorage.element(idxUp))
    );

    const target = mul(float(0.25), sub(sumE, mul(coarseDx2Uniform, coarseRStorage.element(idx))));
    coarseENextStorage.element(idx).assign(isInterior.select(target, coarseEStorage.element(idx)));
  });

  const prolongateCorrectShader = Fn(() => {
    const idx = instanceIndex;
    const fW = uint(fineWidth);
    const cW = uint(coarseWidth);
    const cH = uint(coarseHeight);

    const fx = idx.remainder(fW);
    const fy = idx.div(fW);

    const cx = clamp(mul(float(fx), float(0.5)), float(0.0), sub(float(cW), float(1.0)));
    const cy = clamp(mul(float(fy), float(0.5)), float(0.0), sub(float(cH), float(1.0)));

    const x0 = uint(cx);
    const y0 = uint(cy);
    const x1 = add(x0, uint(1)).lessThan(cW).select(add(x0, uint(1)), x0);
    const y1 = add(y0, uint(1)).lessThan(cH).select(add(y0, uint(1)), y0);

    const s1 = sub(cx, float(x0));
    const s0 = sub(float(1.0), s1);
    const t1 = sub(cy, float(y0));
    const t0 = sub(float(1.0), t1);

    const i00 = add(mul(y0, cW), x0);
    const i10 = add(mul(y0, cW), x1);
    const i01 = add(mul(y1, cW), x0);
    const i11 = add(mul(y1, cW), x1);

    const e00 = coarseEStorage.element(i00);
    const e10 = coarseEStorage.element(i10);
    const e01 = coarseEStorage.element(i01);
    const e11 = coarseEStorage.element(i11);

    const interpE = add(
      mul(t0, add(mul(s0, e00), mul(s1, e10))),
      mul(t1, add(mul(s0, e01), mul(s1, e11)))
    );

    finePStorage.element(idx).assign(add(finePStorage.element(idx), interpE));
  });

  return {
    residualNode: residualShader().compute(fineSize),
    restrictNode: restrictShader().compute(coarseSize),
    coarseJacobiNode: coarseJacobiShader().compute(coarseSize),
    prolongateCorrectNode: prolongateCorrectShader().compute(fineSize),
    dx2Uniform,
    coarseDx2Uniform,
    buffers: {
      finePAttr,
      finePNextAttr,
      fineDivAttr,
      fineResidualAttr,
      coarseRAttr,
      coarseEAttr,
      coarseENextAttr
    }
  };
}
