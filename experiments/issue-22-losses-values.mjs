// Prints the loss filters and the section losses of losses.js and
// waveguide.js for a few K and rates, to compare bit for bit with the Rust
// port (crates/voice-simulator-core/src/losses.rs, test `print_values`).
import { designLossFilter, viscothermalLoss } from '../src/acoustics/losses.js';
import { lossFactor } from '../src/acoustics/waveguide.js';

for (const rate of [46666.666666666664, 93333.33333333333, 61600, 50000]) {
  for (const K of [0, 0.001, 0.0123456, 0.05, 0.3]) {
    const { b0, b1, a1 } = designLossFilter(K, rate);
    console.log(`filter ${rate} ${K} ${b0} ${b1} ${a1}`);
  }
}
for (const area of [0.01, 0.3, 1, 3, Math.PI]) {
  console.log(`visco ${area} ${viscothermalLoss(1, area, 1.3)}`);
  console.log(
    `factor ${area} ${lossFactor(area) ** 2} ${lossFactor(area) ** 0.5}`
  );
}
