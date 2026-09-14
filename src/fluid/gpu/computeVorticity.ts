/**
 * GPU Vorticity Confinement Compute Pass (TSL)
 *
 * Citation:
 * Fedkiw, R., Stam, J., & Jensen, H. W. (2001). "Visual Simulation of Smoke".
 * Proceedings of the 28th Annual Conference on Computer Graphics and Interactive Techniques (SIGGRAPH '01),
 * ACM, pp. 15–22. https://doi.org/10.1145/383259.383260
 *
 * Vorticity Confinement Formulation:
 * 1. omega = curl(u) = dv/dx - du/dy
 * 2. N = grad(|omega|) / (|grad(|omega|)| + eps_regularizer)
 * 3. Force = eps * h * (N x omega)
 *    F_x =  eps * h * (N_y * omega)
 *    F_y = -eps * h * (N_x * omega)
 *    u <- u + dt * F_x
 *    v <- v + dt * F_y
 */

import {
  Fn,
  instanceIndex,
  uniform,
  float,
  uint,
  abs,
  sqrt,
  add,
  sub,
  mul,
  div,
  storage
} from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';

export interface VorticityNodeBuffers {
  u?: StorageBufferAttribute;
  v?: StorageBufferAttribute;
  curl?: StorageBufferAttribute;
}

export function createVorticityComputeNode(
  width: number,
  height: number,
  buffers?: VorticityNodeBuffers
) {
  const size = width * height;
  const strengthUniform = uniform(4.0);
  const dtUniform = uniform(1.0 / 60.0);
  const dxUniform = uniform(1.0);
  const halfInvDxUniform = uniform(0.5);

  const uAttr = buffers?.u ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const vAttr = buffers?.v ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const curlAttr = buffers?.curl ?? new StorageBufferAttribute(new Float32Array(size), 1);

  const uStorage = storage(uAttr, 'float', size);
  const vStorage = storage(vAttr, 'float', size);
  const curlStorage = storage(curlAttr, 'float', size);

  const vorticityShader = Fn(() => {
    const idx = instanceIndex;
    const W = uint(width);
    const H = uint(height);
    const x = idx.remainder(W);
    const y = idx.div(W);

    const isInterior = x.greaterThan(uint(0)).and(x.lessThan(sub(W, uint(1))))
      .and(y.greaterThan(uint(0))).and(y.lessThan(sub(H, uint(1))));

    // Neighbors for grad(|omega|)
    const xLeft = x.greaterThan(uint(0)).select(sub(x, uint(1)), x);
    const xRight = x.lessThan(sub(W, uint(1))).select(add(x, uint(1)), x);
    const yDown = y.greaterThan(uint(0)).select(sub(y, uint(1)), y);
    const yUp = y.lessThan(sub(H, uint(1))).select(add(y, uint(1)), y);

    const idxLeft = add(mul(y, W), xLeft);
    const idxRight = add(mul(y, W), xRight);
    const idxDown = add(mul(yDown, W), x);
    const idxUp = add(mul(yUp, W), x);

    const magLeft = abs(curlStorage.element(idxLeft));
    const magRight = abs(curlStorage.element(idxRight));
    const magDown = abs(curlStorage.element(idxDown));
    const magUp = abs(curlStorage.element(idxUp));

    const gradX = mul(sub(magRight, magLeft), halfInvDxUniform);
    const gradY = mul(sub(magUp, magDown), halfInvDxUniform);

    const lenSq = add(mul(gradX, gradX), mul(gradY, gradY));
    const len = add(sqrt(lenSq), float(1e-6));

    const nx = div(gradX, len);
    const ny = div(gradY, len);

    const omega = curlStorage.element(idx);
    const factor = mul(strengthUniform, mul(dxUniform, dtUniform));

    const deltaU = mul(factor, mul(ny, omega));
    const deltaV = mul(factor, mul(sub(float(0.0), nx), omega));

    const curU = uStorage.element(idx);
    const curV = vStorage.element(idx);

    uStorage.element(idx).assign(isInterior.select(add(curU, deltaU), curU));
    vStorage.element(idx).assign(isInterior.select(add(curV, deltaV), curV));
  });

  return {
    node: vorticityShader().compute(size),
    strengthUniform,
    dtUniform,
    dxUniform,
    halfInvDxUniform,
    buffers: {
      uAttr,
      vAttr,
      curlAttr
    }
  };
}
