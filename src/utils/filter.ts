/**
 * Gaussian Signal Smoothing Filters for 6-DOF Inertial Sensors.
 * Convolves raw accelerometer and gyroscope streams with a 1D discrete Gaussian kernel.
 */

export class GaussianFilter1D {
  private kernelSize: number;
  private sigma: number;
  private kernel: number[] = [];
  private buffer: number[] = [];

  constructor(kernelSize: number = 7, sigma: number = 1.2) {
    this.kernelSize = Math.max(3, kernelSize % 2 === 0 ? kernelSize + 1 : kernelSize);
    this.sigma = Math.max(0.1, sigma);
    this.generateKernel();
  }

  private generateKernel() {
    this.kernel = [];
    const radius = Math.floor(this.kernelSize / 2);
    let sum = 0;

    for (let i = -radius; i <= radius; i++) {
      const weight = (1 / (this.sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-(i * i) / (2 * this.sigma * this.sigma));
      this.kernel.push(weight);
      sum += weight;
    }

    for (let i = 0; i < this.kernel.length; i++) {
      this.kernel[i] /= sum;
    }
  }

  public process(val: number): number {
    this.buffer.push(val);
    if (this.buffer.length > this.kernelSize) {
      this.buffer.shift();
    }

    if (this.buffer.length < this.kernelSize) {
      return val;
    }

    let smoothed = 0;
    for (let i = 0; i < this.kernelSize; i++) {
      smoothed += this.buffer[i] * this.kernel[i];
    }
    return smoothed;
  }

  public reset() {
    this.buffer = [];
  }
}

/**
 * 6-DOF Gaussian IMU Stream Smoother
 * Processes [ax, ay, az, gx, gy, gz] simultaneously with independent Gaussian kernels.
 */
export class GaussianIMUFilter6D {
  private filterAx: GaussianFilter1D;
  private filterAy: GaussianFilter1D;
  private filterAz: GaussianFilter1D;
  private filterGx: GaussianFilter1D;
  private filterGy: GaussianFilter1D;
  private filterGz: GaussianFilter1D;

  constructor(kernelSize: number = 7, sigma: number = 1.2) {
    this.filterAx = new GaussianFilter1D(kernelSize, sigma);
    this.filterAy = new GaussianFilter1D(kernelSize, sigma);
    this.filterAz = new GaussianFilter1D(kernelSize, sigma);
    this.filterGx = new GaussianFilter1D(kernelSize, sigma);
    this.filterGy = new GaussianFilter1D(kernelSize, sigma);
    this.filterGz = new GaussianFilter1D(kernelSize, sigma);
  }

  public process(
    ax: number,
    ay: number,
    az: number,
    gx: number,
    gy: number,
    gz: number
  ): {
    ax: number;
    ay: number;
    az: number;
    gx: number;
    gy: number;
    gz: number;
    accelMagnitude: number;
    gyroMagnitude: number;
  } {
    const sAx = this.filterAx.process(ax);
    const sAy = this.filterAy.process(ay);
    const sAz = this.filterAz.process(az);
    const sGx = this.filterGx.process(gx);
    const sGy = this.filterGy.process(gy);
    const sGz = this.filterGz.process(gz);

    const accelMagnitude = Math.sqrt(sAx * sAx + sAy * sAy + sAz * sAz);
    const gyroMagnitude = Math.sqrt(sGx * sGx + sGy * sGy + sGz * sGz);

    return {
      ax: sAx,
      ay: sAy,
      az: sAz,
      gx: sGx,
      gy: sGy,
      gz: sGz,
      accelMagnitude,
      gyroMagnitude,
    };
  }

  public reset() {
    this.filterAx.reset();
    this.filterAy.reset();
    this.filterAz.reset();
    this.filterGx.reset();
    this.filterGy.reset();
    this.filterGz.reset();
  }
}
