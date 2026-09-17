import * as THREE from 'three';

/**
 * Fluid tracer particles / micro-bubble plumes (Phase 3/6).
 */
export class ParticleSystem {
  public points: THREE.Points;

  constructor(count = 500) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.005, transparent: true, opacity: 0.7 });
    this.points = new THREE.Points(geo, mat);
  }
}
