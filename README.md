# IMU Grid Tracker (Pure 2D Neural Odometry)

A standalone React + TypeScript application for pure 2D Cartesian dead-reckoning trajectory tracking using 6-DOF IMU sensors and an edge neural MLP model. Zero external map or GPS dependencies.

## Key Features

1. **Pure 2D Cartesian Grid**:
   - Continuous $(X, Y)$ path plotting on an infinite 2D canvas grid with meter markers.
   - Interactive auto-follow, pan, zoom, and orientation pointer.
2. **Real-time 6-DOF Sensor Waveform Graphs**:
   - Accelerometer magnitude ($\text{m/s}^2$) with 1G baseline and discrete Gaussian smoothing.
   - 3-axis gyroscope angular rate monitoring ($\text{deg/s}$).
3. **Edge Neural Odometry Engine**:
   - Monolithic `inertial_mlp.onnx` executed client-side via WebGPU / WASM SIMD.
   - Physical Zero-Velocity Update (ZUPT) anti-drift gate ($\sigma^2_a < 0.05\text{ m}^2\text{/s}^4$).
4. **Mobile & Simulator Ready**:
   - Built-in HTTPS server for mobile sensor testing on iOS and Android.
   - Real-time kinematic walking motion simulator and step injector.
   - Keyboard shortcuts: `W` (Step), `Space` (Toggle Stream), `A`/`D` (Turn Left/Right).

---

## How to Run

```bash
cd C:\Users\user\Desktop\imu_sync_v2
npm run dev -- --host
```

Open the local HTTPS link on your PC or mobile phone on the same Wi-Fi network (e.g. `https://192.168.x.x:5173`).
