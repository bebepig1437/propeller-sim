import { parseSpecText, type SpecParseResult, type VehicleSpec } from '../config/specParser';

export interface ImportModalOptions {
  onApply: (spec: VehicleSpec, parseResult: SpecParseResult) => void;
}

const EXAMPLE_CANDIDATE_A = `Reconciled High-Burst Vector-Skewed Propulsor (Slotted-Vane Cartridge & 2.03 mm Split-Collet Interface)

Skeletal Frame Mass: 39.5 g (bare carbon-fiber/PETG truss; strictly frame-only).
Propulsion Core (3-Motor Architecture): 3x potted Mabuchi RC-280RA motor canisters
(wax/epoxy encapsulation, 28.0 mm OD PVC housings, silicone lead strain reliefs) = 126.0 g (42.0 g/unit).
Vertical Propulsion Stack: 42 mm bespoke 4-blade rotor (1.85 g) + modular slotted stator
assembly (4.20 g) + M2 stainless hardware & brass inserts (3.80 g) = 9.85 g.
Horizontal Propulsion Stack: 2x 36 mm mirrored rotors (3.20 g) + mounting brackets/clamps (5.20 g) = 8.40 g.
Fasteners, Tether Gland & Wiring Harness: 5.25 g.
Total Dry Mass: 189.0 g.

Submerged volume V_sub = 210.0 cm^3.
Net positive buoyancy F_buoy = +21.0 g-force (+0.206 N).
Metacentric height BG = 14.5 mm.

Motor Terminal Conditions: Nominal 12.0 V source delivered over 15 ft 24 AWG tether
(R_tether = 0.782 Ohm round-trip loop). Under 1.25 A load, terminal voltage drop yields
exactly V_term = 10.82 V.

Armature resistance: Ra = 4.50 Ohm
No-load speed: n0 = 9800 RPM (163.33 rev/s = 1026.3 rad/s)
No-load current: I0 = 0.18 A
Stall current: I_stall = 10.80 / 4.50 = 2.40 A
Stall torque: tau_stall = 0.0260 N.m (26.0 mN.m)
Torque constant: kt = 0.01171 N.m/A
Back-EMF constant: ke = 0.00973 V.s/rad (1.019 mV/RPM)

Throttle Map (10.8 V Rail):
100% Burst: V_eff = 10.80 V | Duty = 100% | 4140 RPM | Current = 1.41 A | T_up ~ +4.73 N | Safe Thermal Run = 18 s max.
88% Heavy Lift: V_eff = 9.51 V | Duty = 88.1% | 3800 RPM | Current = 1.25 A | T_up ~ +3.99 N | Safe Thermal Run = 50 s max.
67% Continuous Cruise: V_eff = 7.24 V | Duty = 67.0% | 3000 RPM | Current = 0.85 A | T_up ~ +2.49 N | Continuous.
-84% Full Dive: V_eff = 9.07 V | Duty = 84.0% | 3650 RPM | Current = 1.18 A | T_down ~ -2.82 N | Safe Thermal Run = 65 s max.

Shaft bore: 2.03 +0.02/-0.00 mm.
Shaft: 2.000 mm (0.0787 in) Mabuchi shaft.
Material: SLA Rigid 10K Resin (rho = 1.65 g/cm^3). Rotor Mass = 1.85 g; I_zz = 3.98e-7 kg.m^2.

Stator: 3-vane slotted stator. Slot chord 40%. Incidence -5.2 deg.`;

export class SpecImportModal {
  private container: HTMLElement;
  private options: ImportModalOptions;
  private state: 'paste' | 'preview' = 'paste';
  private currentRawText = '';
  private currentResult: SpecParseResult | null = null;
  private userOverrides: Map<string, string> = new Map();

  constructor(options: ImportModalOptions) {
    this.options = options;
    this.container = document.createElement('div');
    this.container.id = 'spec-import-modal-backdrop';
    this.container.className = 'modal-backdrop hidden';
    document.body.appendChild(this.container);
    this.render();
  }

  public open(): void {
    this.state = 'paste';
    this.currentResult = null;
    this.userOverrides.clear();
    this.container.classList.remove('hidden');
    this.render();
  }

  public close(): void {
    this.container.classList.add('hidden');
  }

  private render(): void {
    if (this.state === 'paste') {
      this.renderPasteState();
    } else {
      this.renderPreviewState();
    }
  }

  private renderPasteState(): void {
    this.container.innerHTML = `
      <div class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-header">
          <div class="modal-title-group">
            <span class="modal-badge">RAW SPEC AUTO-IMPORTER</span>
            <h2 id="modal-title" class="modal-title">Paste Engineering Specification</h2>
          </div>
          <button id="btn-modal-close" class="modal-close-btn" aria-label="Close modal">✕</button>
        </div>

        <p class="modal-description">
          Paste an engineering spec sheet. Motor constants, rotor geometry, stator config, mass accounting, and operating points will be extracted automatically.
        </p>

        <div class="modal-body">
          <textarea id="spec-input-textarea" class="spec-textarea" placeholder="Paste an engineering spec sheet. Motor constants, rotor geometry, stator config, mass accounting, and operating points will be extracted automatically.">${this.currentRawText}</textarea>
        </div>

        <div class="modal-footer">
          <button id="btn-load-example" class="btn-modal-secondary">Load Candidate A Example</button>
          <div class="modal-footer-right">
            <button id="btn-modal-cancel" class="btn-modal-secondary">Cancel</button>
            <button id="btn-modal-parse" class="btn-modal-primary">Parse Spec</button>
          </div>
        </div>
      </div>
    `;

    const closeBtn = this.container.querySelector('#btn-modal-close');
    closeBtn?.addEventListener('click', () => this.close());

    const cancelBtn = this.container.querySelector('#btn-modal-cancel');
    cancelBtn?.addEventListener('click', () => this.close());

    const loadExampleBtn = this.container.querySelector('#btn-load-example');
    loadExampleBtn?.addEventListener('click', () => {
      const ta = this.container.querySelector('#spec-input-textarea') as HTMLTextAreaElement;
      if (ta) {
        ta.value = EXAMPLE_CANDIDATE_A;
        this.currentRawText = EXAMPLE_CANDIDATE_A;
      }
    });

    const parseBtn = this.container.querySelector('#btn-modal-parse');
    parseBtn?.addEventListener('click', () => {
      const ta = this.container.querySelector('#spec-input-textarea') as HTMLTextAreaElement;
      const text = ta ? ta.value.trim() : '';
      if (!text) return;
      this.currentRawText = text;
      this.currentResult = parseSpecText(text);
      this.state = 'preview';
      this.render();
    });
  }

  private renderPreviewState(): void {
    if (!this.currentResult) return;
    const res = this.currentResult;

    const highCount = res.fields.filter(f => f.confidence === 'high').length;
    const medCount = res.fields.filter(f => f.confidence === 'medium').length;
    const lowCount = res.fields.filter(f => f.confidence === 'low').length;
    const missingCount = res.missing.length;

    let warningHtml = '';
    if (res.warnings.length > 0) {
      warningHtml = `
        <div class="spec-warning-banner">
          <span class="warning-icon">⚠</span>
          <div class="warning-list">
            ${res.warnings.map(w => `<div class="warning-item">${w}</div>`).join('')}
          </div>
        </div>
      `;
    }

    const fieldRows = res.fields
      .filter(f => f.key !== 'operating_points')
      .map(f => {
        const key = f.key;
        const currentVal = this.userOverrides.has(key) ? this.userOverrides.get(key) : f.value;
        const badgeClass = f.confidence === 'high' ? 'badge-high' : f.confidence === 'medium' ? 'badge-medium' : 'badge-low';
        const lineText = f.sourceLine ? `L${f.sourceLine}` : 'derived';
        return `
          <tr class="spec-table-row">
            <td class="spec-field-key">${key}</td>
            <td class="spec-field-val">
              <input type="text" class="spec-field-input" data-key="${key}" value="${currentVal}" />
            </td>
            <td class="spec-field-unit">${f.unit}</td>
            <td><span class="spec-badge ${badgeClass}">${f.confidence.toUpperCase()}</span></td>
            <td class="spec-field-line">${lineText}</td>
          </tr>
        `;
      }).join('');

    const missingRows = res.missing.map(mKey => {
      const currentVal = this.userOverrides.get(mKey) || '';
      return `
        <tr class="spec-table-row missing-row">
          <td class="spec-field-key">${mKey} (missing)</td>
          <td class="spec-field-val">
            <input type="text" class="spec-field-input input-missing" data-key="${mKey}" placeholder="Required: enter value" value="${currentVal}" />
          </td>
          <td class="spec-field-unit">--</td>
          <td><span class="spec-badge badge-missing">MISSING</span></td>
          <td class="spec-field-line">--</td>
        </tr>
      `;
    }).join('');

    const ops = res.vehicle.operating_points;
    const opsRows = ops.map(op => `
      <tr class="spec-table-row">
        <td class="spec-field-key">${op.label}</td>
        <td class="spec-field-val">${(op.throttle * 100).toFixed(0)}% (${op.rpm} RPM, ${op.thrust_N.toFixed(2)} N)</td>
        <td class="spec-field-unit">${op.current_A.toFixed(2)} A</td>
        <td><span class="spec-badge badge-high">HIGH</span></td>
        <td class="spec-field-line">${op.burst_s ? `${op.burst_s}s` : 'cont.'}</td>
      </tr>
    `).join('');

    this.container.innerHTML = `
      <div class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <div class="modal-header">
          <div class="modal-title-group">
            <span class="modal-badge">PARSED SPECIFICATION PREVIEW</span>
            <h2 id="preview-title" class="modal-title">${res.vehicle.name}</h2>
          </div>
          <button id="btn-modal-close" class="modal-close-btn" aria-label="Close modal">✕</button>
        </div>

        <div class="spec-summary-strip">
          <div class="spec-summary-item">Extracted: <strong>${res.fields.length}</strong></div>
          <div class="spec-summary-item text-green">High: <strong>${highCount}</strong></div>
          <div class="spec-summary-item text-amber">Medium: <strong>${medCount}</strong></div>
          <div class="spec-summary-item text-slate">Derived: <strong>${lowCount}</strong></div>
          <div class="spec-summary-item text-red">Missing: <strong>${missingCount}</strong></div>
        </div>

        ${warningHtml}

        <div class="modal-body preview-scroll">
          <table class="spec-preview-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
                <th>Unit</th>
                <th>Confidence</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              ${missingRows}
              ${fieldRows}
              <tr class="spec-table-section"><td colspan="5">Operating Points (${ops.length})</td></tr>
              ${opsRows}
            </tbody>
          </table>
        </div>

        <div class="modal-footer">
          <button id="btn-preview-back" class="btn-modal-secondary">Back to Edit</button>
          <div class="modal-footer-right">
            <button id="btn-preview-apply" class="btn-modal-primary">Apply Specification</button>
          </div>
        </div>
      </div>
    `;

    const closeBtn = this.container.querySelector('#btn-modal-close');
    closeBtn?.addEventListener('click', () => this.close());

    const backBtn = this.container.querySelector('#btn-preview-back');
    backBtn?.addEventListener('click', () => {
      this.state = 'paste';
      this.render();
    });

    const inputs = this.container.querySelectorAll('.spec-field-input');
    inputs.forEach(inp => {
      inp.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const key = target.dataset.key;
        if (key) {
          this.userOverrides.set(key, target.value);
        }
      });
    });

    const applyBtn = this.container.querySelector('#btn-preview-apply');
    applyBtn?.addEventListener('click', () => {
      const v = res.vehicle;

      for (const [k, valStr] of this.userOverrides.entries()) {
        const num = parseFloat(valStr);
        if (k === 'Ra_ohm' && !isNaN(num)) v.motor.Ra_ohm = num;
        if (k === 'Io_A' && !isNaN(num)) v.motor.Io_A = num;
        if (k === 'no_load_rpm' && !isNaN(num)) v.motor.no_load_rpm_at_10v8 = num;
        if (k === 'stall_torque_Nm' && !isNaN(num)) v.motor.stall_torque_Nm = num;
        if (k === 'kt_Nm_per_A' && !isNaN(num)) v.motor.kt_Nm_per_A = num;
        if (k === 'ke_Vs_per_rad' && !isNaN(num)) v.motor.ke_Vs_per_rad = num;
        if (k === 'supply_V' && !isNaN(num)) v.tether.supply_V = num;
        if (k === 'R_tether_ohm' && !isNaN(num)) v.tether.R_roundtrip_ohm = num;
        if (k === 'D_mm' && !isNaN(num)) v.propeller.D_mm = num;
        if (k === 'blade_count' && !isNaN(num)) v.propeller.blades = Math.round(num);
        if (k === 'displaced_cm3' && !isNaN(num)) v.buoyancy.displaced_cm3 = num;
        if (k === 'BG_mm' && !isNaN(num)) v.buoyancy.cob_above_cog_mm = num;
        if (k === 'total_dry_mass_g' && !isNaN(num)) {
          const frameG = num - (v.mass.motor_unit_g * v.mass.motor_count + 9.0 + v.mass.prop_g.rigid10k * v.mass.motor_count);
          v.mass.frame_g = Math.max(10, frameG);
        }
      }

      this.close();
      this.options.onApply(v, res);
    });
  }
}
