/**
 * GPU Sources & Body Force Injection Compute Pass (TSL)
 *
 * Injects:
 * 1. Boundary Inflow Jet: horizontal velocity + dye plume
 * 2. Propeller Body Force: actuator disc axial momentum & swirl injection (Phase 5 coupling)
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

export interface SourcesNodeBuffers {
  u?: StorageBufferAttribute;
  v?: StorageBufferAttribute;
  dye?: StorageBufferAttribute;
}

export function createSourcesComputeNode(
  width = 256,
  height = 128,
  buffers?: SourcesNodeBuffers
) {
  const size = width * height;

  // Inflow Jet uniforms
  const vxUniform = uniform(2.5);
  const vyUniform = uniform(0.0);
  const dyeDensityUniform = uniform(1.0);
  const enabledUniform = uniform(1);

  // Body force uniforms (Propeller coupling)
  const bodyForceActiveUniform = uniform(0);
  const bodyForceXUniform = uniform(0.0);
  const bodyForceYUniform = uniform(0.0);
  const bodyForceRadiusUniform = uniform(16.0);
  const bodyForcePosXUniform = uniform(width * 0.4);
  const bodyForcePosYUniform = uniform(height * 0.5);

  const uAttr = buffers?.u ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const vAttr = buffers?.v ?? new StorageBufferAttribute(new Float32Array(size), 1);
  const dyeAttr = buffers?.dye ?? new StorageBufferAttribute(new Float32Array(size), 1);

  const uStorage = storage(uAttr, 'float', size);
  const vStorage = storage(vAttr, 'float', size);
  const dyeStorage = storage(dyeAttr, 'float', size);

  const sourcesShader = Fn(() => {
    const idx = instanceIndex;
    const W = uint(width);
    const x = idx.remainder(W);
    const y = idx.div(W);

    // 1. Boundary Inflow Jet: left margin x in [1..8], vertical center span [H/2 - 12 .. H/2 + 12]
    const jetYMin = uint(Math.max(1, Math.floor(height * 0.5 - 12)));
    const jetYMax = uint(Math.min(height - 2, Math.floor(height * 0.5 + 12)));
    const inJetX = x.greaterThan(uint(0)).and(x.lessThan(uint(Math.min(8, width - 1))));
    const inJetY = y.greaterThanEqual(jetYMin).and(y.lessThanEqual(jetYMax));
    const inJet = inJetX.and(inJetY).and(enabledUniform.equal(uint(1)));

    const curU = uStorage.element(idx);
    const curV = vStorage.element(idx);
    const curDye = dyeStorage.element(idx);

    // Apply jet
    const uAfterJet = inJet.select(vxUniform, curU);
    const vAfterJet = inJet.select(vyUniform, curV);
    const dyeAfterJet = inJet.select(dyeDensityUniform, curDye);

    // 2. Propeller Body Force injection
    const dx = sub(float(x), bodyForcePosXUniform);
    const dy = sub(float(y), bodyForcePosYUniform);
    const distSq = add(mul(dx, dx), mul(dy, dy));
    const rSq = mul(bodyForceRadiusUniform, bodyForceRadiusUniform);
    const inBodyForce = distSq.lessThanEqual(rSq).and(bodyForceActiveUniform.equal(uint(1)));

    uStorage.element(idx).assign(inBodyForce.select(add(uAfterJet, bodyForceXUniform), uAfterJet));
    vStorage.element(idx).assign(inBodyForce.select(add(vAfterJet, bodyForceYUniform), vAfterJet));
    dyeStorage.element(idx).assign(dyeAfterJet);
  });

  return {
    node: sourcesShader().compute(size),
    vxUniform,
    vyUniform,
    dyeDensityUniform,
    enabledUniform,
    bodyForceActiveUniform,
    bodyForceXUniform,
    bodyForceYUniform,
    bodyForceRadiusUniform,
    bodyForcePosXUniform,
    bodyForcePosYUniform,
    buffers: {
      uAttr,
      vAttr,
      dyeAttr
    }
  };
}
