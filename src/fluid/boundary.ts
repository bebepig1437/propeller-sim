import type { FluidGrid } from './grid';

export type BoundaryType = 'SOLID' | 'OPEN_OUTFLOW' | 'FREE_SLIP' | 'INFLOW';
export type EdgeName = 'left' | 'right' | 'top' | 'bottom';

export interface EdgeBoundaries {
  left: BoundaryType;
  right: BoundaryType;
  top: BoundaryType;
  bottom: BoundaryType;
}

export class BoundaryHandler {
  public edges: EdgeBoundaries;
  public inflowVelocity = 1.5;

  constructor(typeOrEdges: BoundaryType | Partial<EdgeBoundaries> = 'FREE_SLIP') {
    if (typeof typeOrEdges === 'string') {
      this.edges = {
        left: typeOrEdges,
        right: typeOrEdges,
        top: typeOrEdges,
        bottom: typeOrEdges
      };
    } else {
      this.edges = {
        left: typeOrEdges.left ?? 'FREE_SLIP',
        right: typeOrEdges.right ?? 'FREE_SLIP',
        top: typeOrEdges.top ?? 'FREE_SLIP',
        bottom: typeOrEdges.bottom ?? 'FREE_SLIP'
      };
    }
  }

  public get type(): BoundaryType {
    if (
      this.edges.left === this.edges.right &&
      this.edges.right === this.edges.top &&
      this.edges.top === this.edges.bottom
    ) {
      return this.edges.left;
    }
    return this.edges.left;
  }

  public set type(value: BoundaryType) {
    this.setType(value);
  }

  public setType(type: BoundaryType): void {
    this.edges.left = type;
    this.edges.right = type;
    this.edges.top = type;
    this.edges.bottom = type;
  }

  public setEdge(edge: EdgeName, type: BoundaryType): void {
    this.edges[edge] = type;
  }

  public applyVelocityBoundary(grid: FluidGrid): void {
    const W = grid.width;
    const H = grid.height;
    const u = grid.u;
    const v = grid.v;

    switch (this.edges.bottom) {
      case 'SOLID':
        for (let x = 0; x < W; x++) {
          u[x] = -u[x + W];
          v[x] = 0;
        }
        break;
      case 'FREE_SLIP':
        for (let x = 0; x < W; x++) {
          u[x] = u[x + W];
          v[x] = 0;
        }
        break;
      case 'OPEN_OUTFLOW':
        for (let x = 0; x < W; x++) {
          u[x] = u[x + W];
          v[x] = v[x + W];
        }
        break;
    }

    const topRow = (H - 1) * W;
    const topSub = (H - 2) * W;
    switch (this.edges.top) {
      case 'SOLID':
        for (let x = 0; x < W; x++) {
          u[topRow + x] = -u[topSub + x];
          v[topRow + x] = 0;
        }
        break;
      case 'FREE_SLIP':
        for (let x = 0; x < W; x++) {
          u[topRow + x] = u[topSub + x];
          v[topRow + x] = 0;
        }
        break;
      case 'OPEN_OUTFLOW':
        for (let x = 0; x < W; x++) {
          u[topRow + x] = u[topSub + x];
          v[topRow + x] = v[topSub + x];
        }
        break;
    }

    switch (this.edges.left) {
      case 'INFLOW':
        for (let y = 0; y < H; y++) {
          const left = y * W;
          u[left] = this.inflowVelocity;
          v[left] = 0;
        }
        break;
      case 'SOLID':
        for (let y = 0; y < H; y++) {
          const left = y * W;
          u[left] = 0;
          v[left] = -v[left + 1];
        }
        break;
      case 'FREE_SLIP':
        for (let y = 0; y < H; y++) {
          const left = y * W;
          u[left] = 0;
          v[left] = v[left + 1];
        }
        break;
      case 'OPEN_OUTFLOW':
        for (let y = 0; y < H; y++) {
          const left = y * W;
          u[left] = u[left + 1];
          v[left] = v[left + 1];
        }
        break;
    }

    switch (this.edges.right) {
      case 'SOLID':
        for (let y = 0; y < H; y++) {
          const right = y * W + (W - 1);
          u[right] = 0;
          v[right] = -v[right - 1];
        }
        break;
      case 'FREE_SLIP':
        for (let y = 0; y < H; y++) {
          const right = y * W + (W - 1);
          u[right] = 0;
          v[right] = v[right - 1];
        }
        break;
      case 'OPEN_OUTFLOW':
        for (let y = 0; y < H; y++) {
          const right = y * W + (W - 1);
          u[right] = u[right - 1];
          v[right] = v[right - 1];
        }
        break;
    }

    u[0] = 0.5 * (u[1] + u[W]);
    v[0] = 0.5 * (v[1] + v[W]);
    u[W - 1] = 0.5 * (u[W - 2] + u[2 * W - 1]);
    v[W - 1] = 0.5 * (v[W - 2] + v[2 * W - 1]);
    u[(H - 1) * W] = 0.5 * (u[(H - 1) * W + 1] + u[(H - 2) * W]);
    v[(H - 1) * W] = 0.5 * (v[(H - 1) * W + 1] + v[(H - 2) * W]);
    u[H * W - 1] = 0.5 * (u[H * W - 2] + u[(H - 1) * W - 1]);
    v[H * W - 1] = 0.5 * (v[H * W - 2] + v[(H - 1) * W - 1]);
  }

  public applyPressureBoundary(grid: FluidGrid): void {
    const W = grid.width;
    const H = grid.height;
    const p = grid.pressure;

    for (let y = 0; y < H; y++) {
      p[y * W + 0] = p[y * W + 2];
      p[y * W + 1] = p[y * W + 2];
      if (this.edges.right === 'OPEN_OUTFLOW') {
        p[y * W + W - 1] = 0;
        p[y * W + W - 2] = 0;
      } else {
        p[y * W + W - 1] = p[y * W + W - 3];
        p[y * W + W - 2] = p[y * W + W - 3];
      }
    }
    for (let x = 0; x < W; x++) {
      p[0 * W + x] = p[2 * W + x];
      p[1 * W + x] = p[2 * W + x];
      p[(H - 1) * W + x] = p[(H - 3) * W + x];
      p[(H - 2) * W + x] = p[(H - 3) * W + x];
    }
  }

  public applyScalarBoundary(grid: FluidGrid, field: Float32Array): void {
    const W = grid.width;
    const H = grid.height;

    for (let x = 0; x < W; x++) {
      field[x] = field[x + W];
      field[(H - 1) * W + x] = field[(H - 2) * W + x];
    }
    for (let y = 0; y < H; y++) {
      field[y * W] = field[y * W + 1];
      field[y * W + (W - 1)] = field[y * W + (W - 2)];
    }
  }
}
