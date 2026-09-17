/**
 * GPU Jacobi Pressure Poisson Solver Compute Pass (TSL)
 *
 * Citation:
 * Harris, M. J. (2004). "Fast Fluid Dynamics on the GPU".
 * In R. Fernando (Ed.), GPU Gems: Programming Techniques, Tips, and Tricks for Real-Time Graphics (Chapter 38).
 * Addison-Wesley. https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-gpu
 *
 * Poisson Equation:
 *   Laplacian(p) = div(u)
 * Jacobi Relaxation:
 *   p^(k+1)(x, y) = 0.25 * [ p^k(x-1,y) + p^k(x+1,y) + p^k(x,y-1) + p^k(x,y+1) - dx^2 * div(x,y) ]
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

export interface PressureNodeBuffers {
  p?: StorageBufferAttribute;
  pNext?: StorageBufferAttribute;
  divField?: StorageBufferAttribute;
}

export function createPressureComputeNode(
  width: number,
  height: number,
  buffers?: PressureNodeBuffers
) {
  const size = width * height;
  const dx2Uniform = uniform(1.0);

  const pAttr = buffers?.p ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const pNextAttr = buffers?.pNext ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const divAttr = buffers?.divField ?? new StorageBufferAttribute(new Float32Array(size), 1);

  const pStorage = storage(pAttr, 'float', size);
  const pNextStorage = storage(pNextAttr, 'float', size);
  const divStorage = storage(divAttr, 'float', size);

  // Forward Jacobi step: pNext = Jacobi(p, div)
  const jacobiForwardShader = Fn(() => {
    const idx = instanceIndex;
    const W = uint(width);
    const H = uint(height);
    const x = idx.remainder(W);
    const y = idx.div(W);

    const isInterior = x.greaterThan(uint(0)).and(x.lessThan(sub(W, uint(1))))
      .and(y.greaterThan(uint(0))).and(y.lessThan(sub(H, uint(1))));

    // Neumann boundary mirroring on boundary cells
    const xLeft = x.greaterThan(uint(0)).select(sub(x, uint(1)), x);
    const xRight = x.lessThan(sub(W, uint(1))).select(add(x, uint(1)), x);
    const yDown = y.greaterThan(uint(0)).select(sub(y, uint(1)), y);
    const yUp = y.lessThan(sub(H, uint(1))).select(add(y, uint(1)), y);

    const idxLeft = add(mul(y, W), xLeft);
    const idxRight = add(mul(y, W), xRight);
    const idxDown = add(mul(yDown, W), x);
    const idxUp = add(mul(yUp, W), x);

    const sumP = add(
      add(pStorage.element(idxLeft), pStorage.element(idxRight)),
      add(pStorage.element(idxDown), pStorage.element(idxUp))
    );

    const target = mul(float(0.25), sub(sumP, mul(dx2Uniform, divStorage.element(idx))));
    pNextStorage.element(idx).assign(isInterior.select(target, pStorage.element(idx)));
  });

  // Backward Jacobi step: p = Jacobi(pNext, div) for ping-pong
  const jacobiBackwardShader = Fn(() => {
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

    const sumP = add(
      add(pNextStorage.element(idxLeft), pNextStorage.element(idxRight)),
      add(pNextStorage.element(idxDown), pNextStorage.element(idxUp))
    );

    const target = mul(float(0.25), sub(sumP, mul(dx2Uniform, divStorage.element(idx))));
    pStorage.element(idx).assign(isInterior.select(target, pNextStorage.element(idx)));
  });

  return {
    node: jacobiForwardShader().compute(size),
    forwardNode: jacobiForwardShader().compute(size),
    backwardNode: jacobiBackwardShader().compute(size),
    dx2Uniform,
    buffers: {
      pAttr,
      pNextAttr,
      divAttr
    }
  };
}
