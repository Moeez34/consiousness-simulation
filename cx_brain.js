/**
 * Central Complex (CX) Path Integration Neural Model
 * Directly ported from Stone et al. (2017)
 * "An anatomically constrained model for path integration in the bee brain"
 * Reference: research/path-integration/cx_rate.py & central_complex.py
 */

const N_TL2 = 16;
const N_CL1 = 16;
const N_TB1 = 8;
const N_TN1 = 2;
const N_TN2 = 2;
const N_CPU4 = 16;
const N_CPU1A = 14;
const N_CPU1B = 2;
const N_CPU1 = 16;

function sigmoid(v, slope = 1.0, bias = 0.5, noise = 0.005) {
  const result = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const x = v[i] * slope - bias;
    let s = 1.0 / (1.0 + Math.exp(-Math.max(-20, Math.min(20, x))));
    if (noise > 0) {
      s += (Math.random() - 0.5) * 2 * noise;
    }
    result[i] = Math.max(0.0, Math.min(1.0, s));
  }
  return result;
}

function genTbTbWeights(weight = 1.0) {
  const W = [];
  const sinusoid = [];
  for (let i = 0; i < N_TB1; i++) {
    sinusoid.push(-(Math.cos((i * 2 * Math.PI) / N_TB1) - 1.0) / 2.0);
  }
  for (let i = 0; i < N_TB1; i++) {
    const row = new Float32Array(N_TB1);
    for (let j = 0; j < N_TB1; j++) {
      const idx = (j - i + N_TB1) % N_TB1;
      row[j] = weight * sinusoid[idx];
    }
    W.push(row);
  }
  return W;
}

export class CentralComplexBrain {
  constructor(options = {}) {
    this.noise = options.noise !== undefined ? options.noise : 0.008;
    this.cpu4_mem_gain = options.cpu4_mem_gain || 0.005;
    this.tn_prefs = Math.PI / 4.0; // 45 deg optic flow eye preference

    // Tuned layer parameters (Stone et al. 2017)
    this.tl2_slope = 6.8;
    this.tl2_bias = 3.0;
    this.cl1_slope = 3.0;
    this.cl1_bias = -0.5;
    this.tb1_slope = 5.0;
    this.tb1_bias = 0.0;
    this.cpu4_slope = 5.0;
    this.cpu4_bias = 2.5;
    this.cpu1_slope = 5.0;
    this.cpu1_bias = 2.5;

    this.tl2_prefs = new Float32Array(N_TL2);
    for (let i = 0; i < N_TL2; i++) {
      this.tl2_prefs[i] = ((i % N_TB1) * 2 * Math.PI) / N_TB1;
    }

    this.W_TB1_TB1 = genTbTbWeights();

    // Neural activity states
    this.tb1 = new Float32Array(N_TB1).fill(0.5);
    this.cpu4_mem = new Float32Array(N_CPU4).fill(0.5);
    this.cpu4_output_rates = new Float32Array(N_CPU4).fill(0.5);
    this.tl2 = new Float32Array(N_TL2).fill(0.0);
    this.cl1 = new Float32Array(N_CL1).fill(0.0);
    this.tn1 = new Float32Array(2).fill(0.0);
    this.tn2 = new Float32Array(2).fill(0.0);

    this.motor_steering = 0.0;
  }

  // 1. TL2 Compass input (polarized light & sun azimuth)
  tl2_output(theta) {
    const raw = new Float32Array(N_TL2);
    for (let i = 0; i < N_TL2; i++) {
      raw[i] = Math.cos(theta - this.tl2_prefs[i]);
    }
    this.tl2 = sigmoid(raw, this.tl2_slope, this.tl2_bias, this.noise);
    return this.tl2;
  }

  // 2. CL1 Inhibitory Interneurons
  cl1_output(tl2) {
    const raw = new Float32Array(N_CL1);
    for (let i = 0; i < N_CL1; i++) {
      raw[i] = -tl2[i];
    }
    this.cl1 = sigmoid(raw, this.cl1_slope, this.cl1_bias, this.noise);
    return this.cl1;
  }

  // 3. TB1 Protocerebral Bridge Ring Attractor
  tb1_output(cl1, prev_tb1) {
    const prop_cl1 = 0.667;
    const prop_tb1 = 0.333;
    const raw = new Float32Array(N_TB1);

    for (let i = 0; i < N_TB1; i++) {
      const cl1_sum = cl1[i] + cl1[i + 8];
      let tb1_inhibition = 0;
      for (let j = 0; j < N_TB1; j++) {
        tb1_inhibition += this.W_TB1_TB1[i][j] * prev_tb1[j];
      }
      raw[i] = prop_cl1 * cl1_sum - prop_tb1 * tb1_inhibition;
    }

    this.tb1 = sigmoid(raw, this.tb1_slope, this.tb1_bias, this.noise);
    return this.tb1;
  }

  // 4. Optic Flow Velocity Sensors (TN1 & TN2)
  get_flow(heading, velocityX, velocityZ) {
    const sinL = Math.sin(heading + this.tn_prefs);
    const cosL = Math.cos(heading + this.tn_prefs);
    const sinR = Math.sin(heading - this.tn_prefs);
    const cosR = Math.cos(heading - this.tn_prefs);

    const flowL = sinL * velocityX + cosL * velocityZ;
    const flowR = sinR * velocityX + cosR * velocityZ;

    this.tn1[0] = Math.max(0.0, Math.min(1.0, (1.0 - flowL) / 2.0));
    this.tn1[1] = Math.max(0.0, Math.min(1.0, (1.0 - flowR) / 2.0));
    this.tn2[0] = Math.max(0.0, Math.min(1.0, flowL));
    this.tn2[1] = Math.max(0.0, Math.min(1.0, flowR));

    return [flowL, flowR];
  }

  // 5. CPU4 Pontine Memory Integrators (Accumulates Outbound Path / Discharges on Inbound)
  update_cpu4(tb1, tn1, tn2, isHoming = false) {
    for (let i = 0; i < N_CPU4; i++) {
      const tb1_idx = i % N_TB1;
      const isLeft = i < 8;
      const tn1_val = isLeft ? tn1[0] : tn1[1];
      const tn2_val = isLeft ? tn2[0] : tn2[1];

      if (!isHoming) {
        // Outbound foraging: accumulate memory
        const charge = Math.max(0, 0.5 - tn1_val) * this.cpu4_mem_gain * (1.0 - tb1[tb1_idx]);
        const decay = this.cpu4_mem_gain * 0.15 * tn2_val;
        this.cpu4_mem[i] = Math.max(0.0, Math.min(1.0, this.cpu4_mem[i] + charge - decay));
      } else {
        // Inbound homing: path integration discharges as bee flies along return vector towards nest
        const discharge = Math.max(0, 0.5 - tn1_val) * this.cpu4_mem_gain * (1.0 - tb1[tb1_idx]) * 1.8;
        // Discharge memory towards baseline (0.5)
        if (this.cpu4_mem[i] > 0.5) {
          this.cpu4_mem[i] = Math.max(0.5, this.cpu4_mem[i] - discharge);
        } else if (this.cpu4_mem[i] < 0.5) {
          this.cpu4_mem[i] = Math.min(0.5, this.cpu4_mem[i] + discharge);
        }
      }
    }

    this.cpu4_output_rates = sigmoid(this.cpu4_mem, this.cpu4_slope, this.cpu4_bias, this.noise);
    return this.cpu4_output_rates;
  }

  // 6. CPU1 Steering Comparison Network
  update_cpu1(tb1, cpu4) {
    let leftMotorSum = 0;
    let rightMotorSum = 0;

    for (let i = 0; i < 8; i++) {
      const leftInput = cpu4[i] * (1.0 - tb1[i]);
      const rightInput = cpu4[i + 8] * (1.0 - tb1[i]);
      leftMotorSum += leftInput;
      rightMotorSum += rightInput;
    }

    // Positive = turn left towards return vector, Negative = turn right
    this.motor_steering = (rightMotorSum - leftMotorSum) * 2.4;
    return this.motor_steering;
  }

  // Forward Step
  step(heading, velocityX, velocityZ, isHoming = false) {
    this.tl2_output(heading);
    this.cl1_output(this.tl2);
    this.tb1_output(this.cl1, this.tb1);
    this.get_flow(heading, velocityX, velocityZ);
    this.update_cpu4(this.tb1, this.tn1, this.tn2, isHoming);
    this.update_cpu1(this.tb1, this.cpu4_output_rates);

    return {
      tb1: this.tb1,
      cpu4: this.cpu4_output_rates,
      cpu4_mem: this.cpu4_mem,
      motor_steering: this.motor_steering,
      decoded_vector: this.decode_home_vector()
    };
  }

  // Decode polar coordinates (angle & distance from nest)
  decode_home_vector() {
    let sumCos = 0;
    let sumSin = 0;

    for (let i = 0; i < 8; i++) {
      const angle = (i * 2 * Math.PI) / 8;
      const valL = this.cpu4_mem[(i + 1) % 8];
      const valR = this.cpu4_mem[8 + ((i - 1 + 8) % 8)];
      const combined = (valL + valR) - 1.0;

      sumCos += combined * Math.cos(angle);
      sumSin += combined * Math.sin(angle);
    }

    // Angle of outbound displacement
    const outboundAngle = Math.atan2(sumSin, sumCos);
    // Invert angle for return home vector
    let homeAngle = outboundAngle + Math.PI;
    while (homeAngle > Math.PI) homeAngle -= Math.PI * 2;
    while (homeAngle < -Math.PI) homeAngle += Math.PI * 2;

    const distance = Math.sqrt(sumCos * sumCos + sumSin * sumSin) / (this.cpu4_mem_gain * 7.5);

    return {
      angle: homeAngle, // Bearing to home hive
      outbound_angle: outboundAngle,
      distance: distance
    };
  }

  reset_memory() {
    this.cpu4_mem.fill(0.5);
    this.cpu4_output_rates.fill(0.5);
    this.tb1.fill(0.5);
  }
}
