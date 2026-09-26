import type { HudMetricsData } from '../types/telemetry';

export class SimHudStrip {
  private container: HTMLElement;

  private thrustValA!: HTMLElement;
  private torqueValA!: HTMLElement;
  private rpmValA!: HTMLElement;
  private inflowValA!: HTMLElement;
  private jValA!: HTMLElement;
  private etaValA!: HTMLElement;

  private thrustValB!: HTMLElement;
  private torqueValB!: HTMLElement;
  private rpmValB!: HTMLElement;
  private inflowValB!: HTMLElement;
  private jValB!: HTMLElement;
  private etaValB!: HTMLElement;

  private singleStripEl!: HTMLElement;
  private compareContainerEl!: HTMLElement;
  private tableRows: Record<string, { valA: HTMLElement; valB: HTMLElement; delta: HTMLElement }> = {};

  private isCompare = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.buildMarkup();
  }

  private buildMarkup(): void {
    this.container.innerHTML = `
      <div id="hud-single" class="hud-strip-inner single-mode">
        <div class="hud-stat-cell" title="Thrust: Axial force along +X, computed by BEMT from sectional lift and drag.">
          <span class="hud-reading thrust-accent">
            <span id="hud-thrust-val-a">--</span><span class="hud-unit"> N</span>
          </span>
        </div>
        <div class="hud-stat-cell" title="Torque: Torque absorbed from the shaft. Positive when shaft does work on fluid.">
          <span class="hud-reading torque-accent">
            <span id="hud-torque-val-a">--</span><span class="hud-unit"> mN·m</span>
          </span>
        </div>
        <div class="hud-stat-cell" title="RPM: Integrated shaft rotational speed from motor electromechanical equilibrium.">
          <span class="hud-reading neutral-accent">
            <span id="hud-rpm-val-a">0</span><span class="hud-unit"> RPM</span>
            <span id="hud-rpm-suffix-a" class="hud-state-suffix"> (water)</span>
          </span>
        </div>
        <div class="hud-stat-cell" title="Inflow: Axial fluid velocity sampled at the propeller disc plane.">
          <span class="hud-reading neutral-accent">
            <span id="hud-inflow-val-a">--</span><span class="hud-unit"> m/s</span>
          </span>
        </div>
        <div class="hud-stat-cell" title="Advance ratio J: Ratio of axial inflow speed to tip rotational speed (V / (n·D)).">
          <span class="hud-reading neutral-accent">
            <span class="hud-dim">J </span><span id="hud-j-val-a">--</span>
          </span>
        </div>
        <div class="hud-stat-cell" id="hud-eta-cell-a" title="Efficiency η: Ratio of ideal thrust power to shaft power (T·V / (2π·n·Q)). Undefined at static thrust.">
          <span class="hud-reading neutral-accent">
            <span class="hud-dim">η </span><span id="hud-eta-val-a">--</span>
          </span>
        </div>
      </div>

      <div id="hud-compare" class="hud-compare-container" style="display: none;">
        <div class="compare-strips-wrapper">
          <div class="hud-strip-inner compare-col col-a">
            <div class="compare-col-header" id="compare-col-header-a">Design A</div>
            <div class="hud-stat-cell" title="Thrust A">
              <span class="hud-reading thrust-accent"><span id="hud-thrust-val-cmp-a">--</span><span class="hud-unit"> N</span></span>
            </div>
            <div class="hud-stat-cell" title="Torque A">
              <span class="hud-reading torque-accent"><span id="hud-torque-val-cmp-a">--</span><span class="hud-unit"> mN·m</span></span>
            </div>
            <div class="hud-stat-cell" title="RPM A">
              <span class="hud-reading neutral-accent"><span id="hud-rpm-val-cmp-a">--</span><span class="hud-unit"> RPM</span><span id="hud-rpm-suffix-cmp-a" class="hud-state-suffix"></span></span>
            </div>
            <div class="hud-stat-cell" title="Inflow A">
              <span class="hud-reading neutral-accent"><span id="hud-inflow-val-cmp-a">--</span><span class="hud-unit"> m/s</span></span>
            </div>
            <div class="hud-stat-cell" title="Advance ratio J A">
              <span class="hud-reading neutral-accent"><span class="hud-dim">J </span><span id="hud-j-val-cmp-a">--</span></span>
            </div>
            <div class="hud-stat-cell" title="Efficiency η A">
              <span class="hud-reading neutral-accent"><span class="hud-dim">η </span><span id="hud-eta-val-cmp-a">--</span></span>
            </div>
          </div>

          <div class="hud-strip-inner compare-col col-b">
            <div class="compare-col-header" id="compare-col-header-b">Design B</div>
            <div class="hud-stat-cell" title="Thrust B">
              <span class="hud-reading thrust-accent"><span id="hud-thrust-val-cmp-b">--</span><span class="hud-unit"> N</span></span>
            </div>
            <div class="hud-stat-cell" title="Torque B">
              <span class="hud-reading torque-accent"><span id="hud-torque-val-cmp-b">--</span><span class="hud-unit"> mN·m</span></span>
            </div>
            <div class="hud-stat-cell" title="RPM B">
              <span class="hud-reading neutral-accent"><span id="hud-rpm-val-cmp-b">--</span><span class="hud-unit"> RPM</span><span id="hud-rpm-suffix-cmp-b" class="hud-state-suffix"></span></span>
            </div>
            <div class="hud-stat-cell" title="Inflow B">
              <span class="hud-reading neutral-accent"><span id="hud-inflow-val-cmp-b">--</span><span class="hud-unit"> m/s</span></span>
            </div>
            <div class="hud-stat-cell" title="Advance ratio J B">
              <span class="hud-reading neutral-accent"><span class="hud-dim">J </span><span id="hud-j-val-cmp-b">--</span></span>
            </div>
            <div class="hud-stat-cell" title="Efficiency η B">
              <span class="hud-reading neutral-accent"><span class="hud-dim">η </span><span id="hud-eta-val-cmp-b">--</span></span>
            </div>
          </div>
        </div>

        <div class="comparison-table-wrapper">
          <table class="comparison-table">
            <thead>
              <tr>
                <th class="th-metric">Metric</th>
                <th class="th-a" id="th-name-a">Design A</th>
                <th class="th-b" id="th-name-b">Design B</th>
                <th class="th-delta">Δ</th>
              </tr>
            </thead>
            <tbody>
              <tr id="row-thrust" title="Higher thrust is better (+)">
                <td class="td-label">Thrust (N)</td>
                <td class="td-val" id="tbl-thrust-a">--</td>
                <td class="td-val" id="tbl-thrust-b">--</td>
                <td class="td-delta" id="tbl-thrust-d">--</td>
              </tr>
              <tr id="row-torque" title="Lower torque is better (−)">
                <td class="td-label">Torque (mN·m)</td>
                <td class="td-val" id="tbl-torque-a">--</td>
                <td class="td-val" id="tbl-torque-b">--</td>
                <td class="td-delta" id="tbl-torque-d">--</td>
              </tr>
              <tr id="row-rpm" title="Shaft rotational speed">
                <td class="td-label">RPM</td>
                <td class="td-val" id="tbl-rpm-a">--</td>
                <td class="td-val" id="tbl-rpm-b">--</td>
                <td class="td-delta" id="tbl-rpm-d">--</td>
              </tr>
              <tr id="row-j" title="Advance ratio J">
                <td class="td-label">J</td>
                <td class="td-val" id="tbl-j-a">--</td>
                <td class="td-val" id="tbl-j-b">--</td>
                <td class="td-delta" id="tbl-j-d">--</td>
              </tr>
              <tr id="row-eta" title="Higher efficiency is better (+)">
                <td class="td-label">η (%)</td>
                <td class="td-val" id="tbl-eta-a">--</td>
                <td class="td-val" id="tbl-eta-b">--</td>
                <td class="td-delta" id="tbl-eta-d">--</td>
              </tr>
              <tr id="row-pshaft" title="Lower shaft power for same output is better (−)">
                <td class="td-label">P_shaft (W)</td>
                <td class="td-val" id="tbl-pshaft-a">--</td>
                <td class="td-val" id="tbl-pshaft-b">--</td>
                <td class="td-delta" id="tbl-pshaft-d">--</td>
              </tr>
              <tr id="row-pideal" title="Ideal induced power = T² / (2ρA)">
                <td class="td-label">P_ideal (W)</td>
                <td class="td-val" id="tbl-pideal-a">--</td>
                <td class="td-val" id="tbl-pideal-b">--</td>
                <td class="td-delta" id="tbl-pideal-d">--</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.singleStripEl = this.container.querySelector('#hud-single') as HTMLElement;
    this.compareContainerEl = this.container.querySelector('#hud-compare') as HTMLElement;

    this.thrustValA = this.container.querySelector('#hud-thrust-val-a') as HTMLElement;
    this.torqueValA = this.container.querySelector('#hud-torque-val-a') as HTMLElement;
    this.rpmValA = this.container.querySelector('#hud-rpm-val-a') as HTMLElement;
    this.inflowValA = this.container.querySelector('#hud-inflow-val-a') as HTMLElement;
    this.jValA = this.container.querySelector('#hud-j-val-a') as HTMLElement;
    this.etaValA = this.container.querySelector('#hud-eta-val-a') as HTMLElement;

    this.thrustValB = this.container.querySelector('#hud-thrust-val-cmp-b') as HTMLElement;
    this.torqueValB = this.container.querySelector('#hud-torque-val-cmp-b') as HTMLElement;
    this.rpmValB = this.container.querySelector('#hud-rpm-val-cmp-b') as HTMLElement;
    this.inflowValB = this.container.querySelector('#hud-inflow-val-cmp-b') as HTMLElement;
    this.jValB = this.container.querySelector('#hud-j-val-cmp-b') as HTMLElement;
    this.etaValB = this.container.querySelector('#hud-eta-val-cmp-b') as HTMLElement;

    this.setupTableRefs();
  }

  private setupTableRefs(): void {
    const keys = ['thrust', 'torque', 'rpm', 'j', 'eta', 'pshaft', 'pideal'];
    for (const key of keys) {
      this.tableRows[key] = {
        valA: this.container.querySelector(`#tbl-${key}-a`) as HTMLElement,
        valB: this.container.querySelector(`#tbl-${key}-b`) as HTMLElement,
        delta: this.container.querySelector(`#tbl-${key}-d`) as HTMLElement
      };
    }
  }

  public setCompareMode(enabled: boolean, nameA = 'Candidate A', nameB = 'Kaplan High-Thrust'): void {
    this.isCompare = enabled;
    if (this.singleStripEl) this.singleStripEl.style.display = enabled ? 'none' : 'flex';
    if (this.compareContainerEl) this.compareContainerEl.style.display = enabled ? 'flex' : 'none';

    const thA = this.container.querySelector('#th-name-a');
    const thB = this.container.querySelector('#th-name-b');
    const hdrA = this.container.querySelector('#compare-col-header-a');
    const hdrB = this.container.querySelector('#compare-col-header-b');
    if (thA) thA.textContent = nameA;
    if (thB) thB.textContent = nameB;
    if (hdrA) hdrA.textContent = `A: ${nameA}`;
    if (hdrB) hdrB.textContent = `B: ${nameB}`;
  }

  public update(
    metricsA: HudMetricsData,
    metricsB?: HudMetricsData,
    isCompareMode = false,
    nameA = 'Candidate A',
    nameB = 'Kaplan High-Thrust'
  ): void {
    if (this.isCompare !== isCompareMode) {
      this.setCompareMode(isCompareMode, nameA, nameB);
    }

    if (!isCompareMode) {
      this.updateSingleStrip(metricsA);
    } else {
      this.updateCompareStripA(metricsA);
      if (metricsB) {
        this.updateCompareStripB(metricsB);
        this.updateComparisonTable(metricsA, metricsB);
      }
    }
  }

  private updateSingleStrip(m: HudMetricsData): void {
    this.thrustValA.textContent = m.thrustN.toFixed(2);
    this.torqueValA.textContent = (m.torqueNm * 1000).toFixed(2);

    const suffixEl = this.container.querySelector('#hud-rpm-suffix-a') as HTMLElement;
    if (suffixEl) {
      const scaleStr = Math.abs(m.timeScale - 1.0) > 1e-4 ? ` ×${m.timeScale}` : '';
      suffixEl.textContent = ` (${m.medium})${scaleStr}`;
    }
    this.rpmValA.textContent = Math.round(m.rpm).toString();

    this.inflowValA.textContent = m.inflowSpeedMs.toFixed(2);
    this.jValA.textContent = m.advanceRatioJ.toFixed(3);

    const etaCell = this.container.querySelector('#hud-eta-cell-a') as HTMLElement;
    if (m.efficiency !== null && Number.isFinite(m.efficiency)) {
      this.etaValA.textContent = `${(m.efficiency * 100).toFixed(1)}%`;
      if (etaCell) etaCell.title = `Efficiency η: ${(m.efficiency * 100).toFixed(1)}% (T·V / P_shaft)`;
    } else {
      this.etaValA.textContent = '--';
      if (etaCell) etaCell.title = 'Efficiency is undefined at static thrust (bollard pull V=0).';
    }
  }

  private updateCompareStripA(m: HudMetricsData): void {
    const tEl = this.container.querySelector('#hud-thrust-val-cmp-a');
    const qEl = this.container.querySelector('#hud-torque-val-cmp-a');
    const rEl = this.container.querySelector('#hud-rpm-val-cmp-a');
    const sfxEl = this.container.querySelector('#hud-rpm-suffix-cmp-a');
    const vEl = this.container.querySelector('#hud-inflow-val-cmp-a');
    const jEl = this.container.querySelector('#hud-j-val-cmp-a');
    const etaEl = this.container.querySelector('#hud-eta-val-cmp-a');

    if (tEl) tEl.textContent = m.thrustN.toFixed(2);
    if (qEl) qEl.textContent = (m.torqueNm * 1000).toFixed(2);
    if (rEl) rEl.textContent = Math.round(m.rpm).toString();
    if (sfxEl) {
      const scaleStr = Math.abs(m.timeScale - 1.0) > 1e-4 ? ` ×${m.timeScale}` : '';
      sfxEl.textContent = ` (${m.medium})${scaleStr}`;
    }
    if (vEl) vEl.textContent = m.inflowSpeedMs.toFixed(2);
    if (jEl) jEl.textContent = m.advanceRatioJ.toFixed(3);
    if (etaEl) {
      etaEl.textContent = m.efficiency !== null && Number.isFinite(m.efficiency)
        ? `${(m.efficiency * 100).toFixed(1)}%`
        : '--';
    }
  }

  private updateCompareStripB(m: HudMetricsData): void {
    if (this.thrustValB) this.thrustValB.textContent = m.thrustN.toFixed(2);
    if (this.torqueValB) this.torqueValB.textContent = (m.torqueNm * 1000).toFixed(2);
    if (this.rpmValB) this.rpmValB.textContent = Math.round(m.rpm).toString();

    const sfxEl = this.container.querySelector('#hud-rpm-suffix-cmp-b') as HTMLElement;
    if (sfxEl) {
      const scaleStr = Math.abs(m.timeScale - 1.0) > 1e-4 ? ` ×${m.timeScale}` : '';
      sfxEl.textContent = ` (${m.medium})${scaleStr}`;
    }
    if (this.inflowValB) this.inflowValB.textContent = m.inflowSpeedMs.toFixed(2);
    if (this.jValB) this.jValB.textContent = m.advanceRatioJ.toFixed(3);
    if (this.etaValB) {
      this.etaValB.textContent = m.efficiency !== null && Number.isFinite(m.efficiency)
        ? `${(m.efficiency * 100).toFixed(1)}%`
        : '--';
    }
  }

  private updateComparisonTable(a: HudMetricsData, b: HudMetricsData): void {
    this.updateRow('thrust', a.thrustN, b.thrustN, 'higher', 2);
    this.updateRow('torque', a.torqueNm * 1000, b.torqueNm * 1000, 'lower', 2);
    this.updateRow('rpm', a.rpm, b.rpm, 'neutral', 0);
    this.updateRow('j', a.advanceRatioJ, b.advanceRatioJ, 'higher', 3);

    const etaRow = this.tableRows.eta;
    if (etaRow) {
      etaRow.valA.textContent = a.efficiency !== null ? (a.efficiency * 100).toFixed(1) : '--';
      etaRow.valB.textContent = b.efficiency !== null ? (b.efficiency * 100).toFixed(1) : '--';
      if (a.efficiency !== null && b.efficiency !== null && Math.abs(a.efficiency) > 1e-4) {
        const deltaPct = ((b.efficiency - a.efficiency) / a.efficiency) * 100;
        this.renderDelta(etaRow.delta, deltaPct, 'higher');
      } else {
        etaRow.delta.textContent = '--';
        etaRow.delta.className = 'td-delta neutral';
      }
    }

    const pShaftA = a.pShaftW ?? (2 * Math.PI * (a.rpm / 60) * a.torqueNm);
    const pShaftB = b.pShaftW ?? (2 * Math.PI * (b.rpm / 60) * b.torqueNm);
    this.updateRow('pshaft', pShaftA, pShaftB, 'lower', 2);

    const pIdealA = a.pIdealW ?? 0;
    const pIdealB = b.pIdealW ?? 0;
    this.updateRow('pideal', pIdealA, pIdealB, 'neutral', 2);
  }

  private updateRow(
    key: string,
    valA: number,
    valB: number,
    betterRule: 'higher' | 'lower' | 'neutral',
    decimals: number
  ): void {
    const row = this.tableRows[key];
    if (!row) return;

    row.valA.textContent = valA.toFixed(decimals);
    row.valB.textContent = valB.toFixed(decimals);

    if (Math.abs(valA) > 1e-5) {
      const deltaPct = ((valB - valA) / Math.abs(valA)) * 100;
      this.renderDelta(row.delta, deltaPct, betterRule);
    } else {
      row.delta.textContent = '--';
      row.delta.className = 'td-delta neutral';
    }
  }

  private renderDelta(el: HTMLElement, deltaPct: number, betterRule: 'higher' | 'lower' | 'neutral'): void {
    const sign = deltaPct >= 0 ? '+' : '';
    el.textContent = `${sign}${deltaPct.toFixed(1)}%`;

    if (betterRule === 'neutral' || Math.abs(deltaPct) < 0.1) {
      el.className = 'td-delta neutral';
      return;
    }

    const isBetter = betterRule === 'higher' ? deltaPct > 0 : deltaPct < 0;
    el.className = isBetter ? 'td-delta better' : 'td-delta worse';
  }
}
