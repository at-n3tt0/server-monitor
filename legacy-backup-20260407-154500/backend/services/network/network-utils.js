function average(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, precision = 2) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function calculateJitter(samples) {
  if (samples.length < 2) {
    return 0;
  }
  const deltas = [];
  for (let index = 1; index < samples.length; index += 1) {
    deltas.push(Math.abs(samples[index] - samples[index - 1]));
  }
  return round(average(deltas));
}

module.exports = {
  average,
  round,
  calculateJitter
};
