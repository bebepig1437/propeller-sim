/**
 * GPU Velocity Projection Compute Pass (TSL)
 *
 * Citation:
 * Harris, M. J. (2004). "Fast Fluid Dynamics on the GPU".
 * In R. Fernando (Ed.), GPU Gems: Programming Techniques, Tips, and Tricks for Real-Time Graphics (Chapter 38).
 * Addison-Wesley. https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-gpu
 *
 * Projection Step:
 *   u^(n+1) = u* - grad(p)
 *   u(x, y) <- u(x, y) - 0.5 * invDx * (p(x+1, y) - p(x-1, y))
 *   v(x, y) <- v(x, y) - 0.5 * invDx * (p(x, y+1) - p(x, y-1))
 */

import {
  Fn,
  instanceIndex,
  uniform,
  uint,
  add,
  sub,
  mul,
  storage
} from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';

export interface ProjectNodeBuffers {
  u?: StorageBufferAttribute;
  v?: StorageBufferAttribute;
  p?: StorageBufferAttribute;
}

export function createProjectComputeNode(
  width: number,
  height: number,
  buffers?: ProjectNodeBuffers
) {
  const size = width * height;
  const halfInvDxUniform = uniform(0.5);

  const uAttr = buffers?.u ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const vAttr = buffers?.v ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const pAttr = buffers?.p ?? new StorageBufferAttribute(new Float32Array(size), 1);

  const uStorage = storage(uAttr, 'float', size);
  const vStorage = storage(vAttr, 'float', size);
  const pStorage = storage(pAttr, 'float', size);

  const projectShader = Fn(() => {
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

    const gradPx = mul(sub(pStorage.element(idxRight), pStorage.element(idxLeft)), halfInvDxUniform);
    const gradPy = mul(sub(pStorage.element(idxUp), pStorage.element(idxDown)), halfInvDxUniform);

    const curU = uStorage.element(idx);
    const curV = vStorage.element(idx);

    uStorage.element(idx).assign(isInterior.select(sub(curU, gradPx), curU));
    vStorage.element(idx).assign(isInterior.select(sub(curV, gradPy), curV));
  });

  return {
    node: projectShader().compute(size),
    halfInvDxUniform,
    buffers: {
      uAttr,
      vAttr,
      pAttr
    }
  };
}
