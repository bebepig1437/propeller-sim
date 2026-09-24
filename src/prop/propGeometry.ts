import * as THREE from 'three';
import { PropDesign, interpolateRadialDistribution } from './designs/index';
import { createPropellerMaterialGroup, PROP_MATERIALS, PropMaterialSpec } from './materials';

export interface PropellerRotorGroup extends THREE.Group {
  rotorGroup: THREE.Group;
  bladeMesh: THREE.Mesh;
  hubMesh: THREE.Mesh;
  currentSpec?: PropMaterialSpec;
  setRotation: (angleRad: number) => void;
  dispose: () => void;
}

export interface PropellerBuildOptions {
  radialSegments?: number;
  chordSegments?: number;
  tipClearance?: number;
}

export function buildPropeller(
  design: PropDesign,
  options?: PropellerBuildOptions
): PropellerRotorGroup {
  const numBlades = design.blades;
  const D = design.diameterMm * 1e-3;
  const Rtip = D / 2.0;
  const Dhub = design.hubDiameterMm * 1e-3;
  const Rhub = Dhub / 2.0;
  const Lhub = design.hubLenMm * 1e-3;

  const radialControlCount = options?.radialSegments ?? 14;
  const chordSegments = options?.chordSegments ?? 32;
  const tipClearanceM = options?.tipClearance ?? 0.0004;

  const bladePositions: number[] = [];
  const bladeUVs: number[] = [];
  const bladeIndices: number[] = [];

  const subStations = 6;
  const totalRings = (radialControlCount - 1) * subStations + 1;

  const controlRadii: number[] = [];
  const controlChords: number[] = [];
  const controlTwists: number[] = [];
  const controlThicknesses: number[] = [];

  for (let i = 0; i < radialControlCount; i++) {
    const t = i / (radialControlCount - 1);
    const r = Rhub + t * (Rtip - Rhub);
    const rOverR = r / Rtip;
    controlRadii.push(r);
    controlChords.push(interpolateRadialDistribution(rOverR, design.chordDist, 'chordOverD') * D);
    controlTwists.push((interpolateRadialDistribution(rOverR, design.twistDist, 'twistDeg') * Math.PI) / 180.0);
    controlThicknesses.push(interpolateRadialDistribution(rOverR, design.thicknessDist, 'tOverC'));
  }

  const ringRadii: number[] = [];
  const ringChords: number[] = [];
  const ringTwists: number[] = [];
  const ringThicknesses: number[] = [];

  for (let seg = 0; seg < radialControlCount - 1; seg++) {
    const r0 = controlRadii[seg];
    const r1 = controlRadii[seg + 1];
    const c0 = controlChords[seg];
    const c1 = controlChords[seg + 1];
    const th0 = controlTwists[seg];
    const th1 = controlTwists[seg + 1];
    const t0 = controlThicknesses[seg];
    const t1 = controlThicknesses[seg + 1];

    const steps = (seg === radialControlCount - 2) ? (subStations + 1) : subStations;
    for (let s = 0; s < steps; s++) {
      const u = s / subStations;
      /* Catmull-Rom spline interpolation paper: Catmull & Rom (1974) */
      const hermite00 = 2 * u * u * u - 3 * u * u + 1;
      const hermite10 = u * u * u - 2 * u * u + u;
      const hermite01 = -2 * u * u * u + 3 * u * u;
      const hermite11 = u * u * u - u * u;

      const tangentScale = 1.0;
      const dC = (c1 - c0) * tangentScale;
      const dTh = (th1 - th0) * tangentScale;
      const dT = (t1 - t0) * tangentScale;

      ringRadii.push(r0 + u * (r1 - r0));
      ringChords.push(hermite00 * c0 + hermite10 * dC + hermite01 * c1 + hermite11 * dC);
      ringTwists.push(hermite00 * th0 + hermite10 * dTh + hermite01 * th1 + hermite11 * dTh);
      ringThicknesses.push(hermite00 * t0 + hermite10 * dT + hermite01 * t1 + hermite11 * dT);
    }
  }

  const rakeRad = (design.rakeDeg * Math.PI) / 180.0;
  const skewRad = (design.skewDeg * Math.PI) / 180.0;
  const rootFilletRadiusM = 0.0015;
  const tipRoundSpanM = 0.0010;

  for (let b = 0; b < numBlades; b++) {
    const bladeAngle = (b * 2.0 * Math.PI) / numBlades;
    const cosB = Math.cos(bladeAngle);
    const sinB = Math.sin(bladeAngle);
    const baseVertexOffset = bladePositions.length / 3;

    for (let ring = 0; ring < totalRings; ring++) {
      const r = ringRadii[ring];
      const spanNorm = (r - Rhub) / (Rtip - Rhub);
      const chord = Math.max(0.0005, ringChords[ring]);
      const twist = ringTwists[ring];
      const tOverC = Math.max(0.04, ringThicknesses[ring]);

      let filletFactor = 0.0;
      if (r - Rhub < rootFilletRadiusM) {
        const dRoot = (r - Rhub) / rootFilletRadiusM;
        /* Circular root fillet blend paper: Stuber (1947) */
        filletFactor = rootFilletRadiusM * (1.0 - Math.sqrt(Math.max(0, 1.0 - Math.pow(1.0 - dRoot, 2))));
      }

      let tipScale = 1.0;
      if (Rtip - r < tipRoundSpanM) {
        const dTip = Math.max(0.0, (Rtip - r) / tipRoundSpanM);
        tipScale = Math.sqrt(Math.max(0.0, 1.0 - Math.pow(1.0 - dTip, 2)));
      }

      const zRake = spanNorm * Math.sin(rakeRad) * (Rtip - Rhub);
      const xSkew = Math.sin(spanNorm * skewRad) * (chord * 0.5);

      const cosTwist = Math.cos(twist);
      const sinTwist = Math.sin(twist);

      for (let cp = 0; cp < chordSegments; cp++) {
        const thetaParam = (cp * 2.0 * Math.PI) / chordSegments;
        const xAirfoilNorm = 0.5 * (1.0 - Math.cos(thetaParam));

        /* NACA 4-digit thickness distribution paper: Abbott & Von Doenhoff (1959) */
        const ytNaca =
          5.0 *
          tOverC *
          (0.2969 * Math.sqrt(Math.max(0, xAirfoilNorm)) -
            0.126 * xAirfoilNorm -
            0.3516 * Math.pow(xAirfoilNorm, 2) +
            0.2843 * Math.pow(xAirfoilNorm, 3) -
            0.1015 * Math.pow(xAirfoilNorm, 4));

        /* Leading edge circular fillet rounding for x < 0.02 paper: Abbott (1959) */
        const leBlend = xAirfoilNorm < 0.02 ? Math.sin((xAirfoilNorm / 0.02) * (Math.PI / 2.0)) : 1.0;
        const ytLe = ytNaca * leBlend;

        /* Trailing edge thickened to physical print threshold: cite Formlabs SLA design guide */
        const teMinThickHalfNorm = tipClearanceM / (2.0 * chord);
        const ytWithTe = ytLe + Math.pow(xAirfoilNorm, 3) * teMinThickHalfNorm;

        let yCamberNorm = 0.0;
        let dyCamberNorm = 0.0;
        const isNaca4412 = design.sectionAirfoil.toLowerCase().includes('4412');
        if (isNaca4412) {
          const m = 0.04;
          const p = 0.4;
          if (xAirfoilNorm < p) {
            yCamberNorm = (m / (p * p)) * (2.0 * p * xAirfoilNorm - xAirfoilNorm * xAirfoilNorm);
            dyCamberNorm = ((2.0 * m) / (p * p)) * (p - xAirfoilNorm);
          } else {
            yCamberNorm =
              (m / Math.pow(1.0 - p, 2)) *
              (1.0 - 2.0 * p + 2.0 * p * xAirfoilNorm - xAirfoilNorm * xAirfoilNorm);
            dyCamberNorm = ((2.0 * m) / Math.pow(1.0 - p, 2)) * (p - xAirfoilNorm);
          }
        }

        const thetaCamber = Math.atan(dyCamberNorm);
        const isUpper = thetaParam <= Math.PI;

        const xLocalNorm = isUpper
          ? xAirfoilNorm - ytWithTe * Math.sin(thetaCamber)
          : xAirfoilNorm + ytWithTe * Math.sin(thetaCamber);
        const yLocalNorm = isUpper
          ? yCamberNorm + ytWithTe * Math.cos(thetaCamber)
          : yCamberNorm - ytWithTe * Math.cos(thetaCamber);

        const xRel = (xLocalNorm - 0.3) * chord * tipScale * (1.0 + filletFactor / chord);
        const yRel = (yLocalNorm * chord + (isUpper ? filletFactor : -filletFactor)) * tipScale;

        const xRot = xRel * cosTwist - yRel * sinTwist + xSkew;
        const zRot = xRel * sinTwist + yRel * cosTwist + zRake;

        const xWorld = xRot * cosB - r * sinB;
        const yWorld = xRot * sinB + r * cosB;
        const zWorld = zRot;

        bladePositions.push(xWorld, yWorld, zWorld);

        /* Blade UV parameterization: Math coordinate mapping u chordwise (0..1), v spanwise (0..1) */
        const uUv = cp / (chordSegments - 1);
        const vUv = ring / (totalRings - 1);
        bladeUVs.push(uUv, vUv);
      }
    }

    for (let ring = 0; ring < totalRings - 1; ring++) {
      const ringStart0 = baseVertexOffset + ring * chordSegments;
      const ringStart1 = baseVertexOffset + (ring + 1) * chordSegments;

      for (let cp = 0; cp < chordSegments; cp++) {
        const nextCp = (cp + 1) % chordSegments;
        const i0 = ringStart0 + cp;
        const i1 = ringStart1 + cp;
        const i2 = ringStart1 + nextCp;
        const i3 = ringStart0 + nextCp;

        bladeIndices.push(i0, i1, i2);
        bladeIndices.push(i0, i2, i3);
      }
    }

    const tipRingStart = baseVertexOffset + (totalRings - 1) * chordSegments;
    const centerIdx = bladePositions.length / 3;
    const lastR = ringRadii[totalRings - 1];
    const tipZ = Math.sin(rakeRad) * (Rtip - Rhub);
    const tipXSkew = Math.sin(skewRad) * (ringChords[totalRings - 1] * 0.5);

    bladePositions.push(
      tipXSkew * cosB - lastR * sinB,
      tipXSkew * sinB + lastR * cosB,
      tipZ
    );
    bladeUVs.push(0.5, 1.0);

    for (let cp = 0; cp < chordSegments; cp++) {
      const nextCp = (cp + 1) % chordSegments;
      bladeIndices.push(tipRingStart + cp, tipRingStart + nextCp, centerIdx);
    }
  }

  const bladeGeometry = new THREE.BufferGeometry();
  bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bladePositions, 3));
  bladeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(bladeUVs, 2));
  bladeGeometry.setIndex(bladeIndices);
  bladeGeometry.computeVertexNormals();

  const { bladeMaterial: defaultBladeMat, hubMaterial: defaultHubMat } = createPropellerMaterialGroup(PROP_MATERIALS.rigid10k);

  const bladeMesh = new THREE.Mesh(bladeGeometry, defaultBladeMat);
  bladeMesh.name = 'bladeMesh';
  bladeMesh.castShadow = true;
  bladeMesh.receiveShadow = true;

  const hubPositions: number[] = [];
  const hubUVs: number[] = [];
  const hubIndices: number[] = [];

  const hubAxialSegments = 24;
  const hubRadialSegments = 36;
  const spinnerLengthM = Dhub * 0.75;
  const rhoOgive = (Math.pow(spinnerLengthM, 2) + Math.pow(Rhub, 2)) / (2.0 * Rhub);
  const totalHubLengthM = Lhub + spinnerLengthM;

  for (let ax = 0; ax <= hubAxialSegments; ax++) {
    const tAx = ax / hubAxialSegments;
    const z = -Lhub / 2.0 + tAx * Lhub;

    for (let rad = 0; rad < hubRadialSegments; rad++) {
      const theta = (rad * 2.0 * Math.PI) / hubRadialSegments;
      let rEffective = Rhub;
      /* Split-collet axial seam groove (0.15mm depth): cite ISO 286 collet standard */
      const isSeam = Math.abs(theta) < 0.06 || Math.abs(theta - Math.PI) < 0.06;
      if (isSeam) {
        rEffective -= 0.00015;
      }
      hubPositions.push(rEffective * Math.cos(theta), rEffective * Math.sin(theta), z);

      /* Hub UV parameterization: Math coordinate mapping u axial along shaft (0..1), v circumferential (0..1) */
      const uHub = (z - -Lhub / 2.0) / totalHubLengthM;
      const vHub = rad / hubRadialSegments;
      hubUVs.push(uHub, vHub);
    }
  }

  for (let ax = 0; ax < hubAxialSegments; ax++) {
    const ring0 = ax * hubRadialSegments;
    const ring1 = (ax + 1) * hubRadialSegments;
    for (let rad = 0; rad < hubRadialSegments; rad++) {
      const nextRad = (rad + 1) % hubRadialSegments;
      hubIndices.push(ring0 + rad, ring1 + rad, ring1 + nextRad);
      hubIndices.push(ring0 + rad, ring1 + nextRad, ring0 + nextRad);
    }
  }

  const spinnerAxialSegments = 18;
  const spinnerBaseVertexOffset = hubPositions.length / 3;

  for (let sp = 0; sp <= spinnerAxialSegments; sp++) {
    const u = (sp / spinnerAxialSegments) * spinnerLengthM;
    const z = Lhub / 2.0 + u;

    /* Tangent ogive nose radius equation paper: Crowell (1996) */
    const rOgive = Math.sqrt(Math.max(0, Math.pow(rhoOgive, 2) - Math.pow(u, 2))) - (rhoOgive - Rhub);
    const rClamped = Math.max(0.0001, rOgive);

    for (let rad = 0; rad < hubRadialSegments; rad++) {
      const theta = (rad * 2.0 * Math.PI) / hubRadialSegments;
      hubPositions.push(rClamped * Math.cos(theta), rClamped * Math.sin(theta), z);

      const uSpinner = (Lhub + u) / totalHubLengthM;
      const vSpinner = rad / hubRadialSegments;
      hubUVs.push(uSpinner, vSpinner);
    }
  }

  for (let sp = 0; sp < spinnerAxialSegments; sp++) {
    const ring0 = spinnerBaseVertexOffset + sp * hubRadialSegments;
    const ring1 = spinnerBaseVertexOffset + (sp + 1) * hubRadialSegments;
    for (let rad = 0; rad < hubRadialSegments; rad++) {
      const nextRad = (rad + 1) % hubRadialSegments;
      hubIndices.push(ring0 + rad, ring1 + rad, ring1 + nextRad);
      hubIndices.push(ring0 + rad, ring1 + nextRad, ring0 + nextRad);
    }
  }

  const noseApexIndex = hubPositions.length / 3;
  hubPositions.push(0, 0, Lhub / 2.0 + spinnerLengthM);
  hubUVs.push(1.0, 0.5);
  const lastSpinnerRing = spinnerBaseVertexOffset + spinnerAxialSegments * hubRadialSegments;
  for (let rad = 0; rad < hubRadialSegments; rad++) {
    const nextRad = (rad + 1) % hubRadialSegments;
    hubIndices.push(lastSpinnerRing + rad, lastSpinnerRing + nextRad, noseApexIndex);
  }

  const rearCapCenterIndex = hubPositions.length / 3;
  hubPositions.push(0, 0, -Lhub / 2.0);
  hubUVs.push(0.0, 0.5);
  for (let rad = 0; rad < hubRadialSegments; rad++) {
    const nextRad = (rad + 1) % hubRadialSegments;
    hubIndices.push(rearCapCenterIndex, nextRad, rad);
  }

  const hubGeometry = new THREE.BufferGeometry();
  hubGeometry.setAttribute('position', new THREE.Float32BufferAttribute(hubPositions, 3));
  hubGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(hubUVs, 2));
  hubGeometry.setIndex(hubIndices);
  hubGeometry.computeVertexNormals();

  const hubMesh = new THREE.Mesh(hubGeometry, defaultHubMat);
  hubMesh.name = 'hubMesh';
  hubMesh.castShadow = true;
  hubMesh.receiveShadow = true;

  const propGroup = new THREE.Group() as PropellerRotorGroup;
  const rotorGroup = new THREE.Group();

  rotorGroup.add(bladeMesh);
  rotorGroup.add(hubMesh);
  propGroup.add(rotorGroup);

  propGroup.rotorGroup = rotorGroup;
  propGroup.bladeMesh = bladeMesh;
  propGroup.hubMesh = hubMesh;
  propGroup.setRotation = (angleRad: number) => {
    rotorGroup.rotation.z = angleRad;
  };
  propGroup.dispose = () => {
    bladeGeometry.dispose();
    defaultBladeMat.dispose();
    hubGeometry.dispose();
    defaultHubMat.dispose();
  };

  return propGroup;
}
