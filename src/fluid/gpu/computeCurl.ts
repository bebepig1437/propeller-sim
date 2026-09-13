/**
 * GPU Curl / Vorticity Scalar Compute Pass (TSL)
 *
 * Citation:
 * Fedkiw, R., Stam, J., & Jensen, H. W. (2001). "Visual Simulation of Smoke".
 * Proceedings of SIGGRAPH 2001, pp. 15–22. https://doi.org/10.1145/383259.383260
 *
 * Curl Formulation (Central Differences):
 *   omega = dv/dx - du/dy
 *   omega(x, y) = 0.5 * invDx * [ (v(x+1, y) - v(x-1, y)) - (u(x, y+1) - u(x, y-1)) ]
 */

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

export interface CurlNodeBuffers {
  u?: StorageBufferAttribute;
  v?: StorageBufferAttribute;
  curl?: StorageBufferAttribute;
}

export function createCurlComputeNode(
  width: number,
  height: number,
  buffers?: CurlNodeBuffers
) {
  const size = width * height;
  const invDxUniform = uniform(1.0);
  const halfInvDxUniform = uniform(0.5);

  const uAttr = buffers?.u ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const vAttr = buffers?.v ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const curlAttr = buffers?.curl ?? new StorageBufferAttribute(new Float32Array(size), 1);

  const uStorage = storage(uAttr, 'float', size);
  const vStorage = storage(vAttr, 'float', size);
  const curlStorage = storage(curlAttr, 'float', size);

  const curlShader = Fn(() => {
    const idx = instanceIndex;
    const W = uint(width);
    const H = uint(height);
    const x = idx.remainder(W);
    const y = idx.div(W);

    // Interior check: x in [1..W-2] and y in [1..H-2]
    const isInterior = x.greaterThan(uint(0)).and(x.lessThan(sub(W, uint(1))))
      .and(y.greaterThan(uint(0))).and(y.lessThan(sub(H, uint(1))));

    // Clamped neighbor indices
    const xLeft = x.greaterThan(uint(0)).select(sub(x, uint(1)), x);
    const xRight = x.lessThan(sub(W, uint(1))).select(add(x, uint(1)), x);
    const yDown = y.greaterThan(uint(0)).select(sub(y, uint(1)), y);
    const yUp = y.lessThan(sub(H, uint(1))).select(add(y, uint(1)), y);

    const idxLeft = add(mul(y, W), xLeft);
    const idxRight = add(mul(y, W), xRight);
    const idxDown = add(mul(yDown, W), x);
    const idxUp = add(mul(yUp, W), x);

    const dv_dx = mul(sub(vStorage.element(idxRight), vStorage.element(idxLeft)), halfInvDxUniform);
    const du_dy = mul(sub(uStorage.element(idxUp), uStorage.element(idxDown)), halfInvDxUniform);

    const curlVal = isInterior.select(sub(dv_dx, du_dy), float(0.0));
    curlStorage.element(idx).assign(curlVal);
  });

  return {
    node: curlShader().compute(size),
    invDxUniform,
    halfInvDxUniform,
    buffers: {
      uAttr,
      vAttr,
      curlAttr
    }
  };
}
