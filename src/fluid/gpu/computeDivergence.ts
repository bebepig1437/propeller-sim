import {
  Fn,
  instanceIndex,
  uniform,
  float,
  uint,
  add,
  sub,
  mul,
  storage
} from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';

export interface DivergenceNodeBuffers {
  u?: StorageBufferAttribute;
  v?: StorageBufferAttribute;
  div?: StorageBufferAttribute;
}

export function createDivergenceComputeNode(
  width: number,
  height: number,
  buffers?: DivergenceNodeBuffers
) {
  const size = width * height;
  const halfInvDxUniform = uniform(0.5);

  const uAttr = buffers?.u ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const vAttr = buffers?.v ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const divAttr = buffers?.div ?? new StorageBufferAttribute(new Float32Array(size), 1);

  const uStorage = storage(uAttr, 'float', size);
  const vStorage = storage(vAttr, 'float', size);
  const divStorage = storage(divAttr, 'float', size);

  const divergenceShader = Fn(() => {
    const idx = instanceIndex;
    const W = uint(width);
    const H = uint(height);
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

    const du = sub(uStorage.element(idxRight), uStorage.element(idxLeft));
    const dv = sub(vStorage.element(idxUp), vStorage.element(idxDown));

    const divVal = mul(add(du, dv), halfInvDxUniform);
    divStorage.element(idx).assign(isInterior.select(divVal, float(0.0)));
  });

  return {
    node: divergenceShader().compute(size),
    halfInvDxUniform,
    buffers: {
      uAttr,
      vAttr,
      divAttr
    }
  };
}
