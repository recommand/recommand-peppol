/**
 * Minimal, dependency free Prometheus metric primitives and text exposition.
 * Only the subset needed by this codebase is implemented: counters, gauges and
 * histograms with a fixed set of label names per metric.
 */

export type MetricLabels = Record<string, string>;

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function renderLabels(
  labelNames: string[],
  labelValues: string[],
  extra?: [string, string]
): string {
  const pairs = labelNames.map(
    (name, index) => `${name}="${escapeLabelValue(labelValues[index] ?? "")}"`
  );
  if (extra) {
    pairs.push(`${extra[0]}="${escapeLabelValue(extra[1])}"`);
  }
  return pairs.length > 0 ? `{${pairs.join(",")}}` : "";
}

export abstract class Metric {
  abstract readonly type: string;

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: string[] = []
  ) {}

  protected labelValues(labels: MetricLabels): string[] {
    return this.labelNames.map((name) => labels[name] ?? "");
  }

  protected abstract samples(): string[];

  render(): string {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} ${this.type}`,
      ...this.samples(),
    ].join("\n");
  }
}

type ScalarEntry = { labelValues: string[]; value: number };

export class Counter extends Metric {
  readonly type = "counter";
  private readonly entries = new Map<string, ScalarEntry>();

  inc(labels: MetricLabels = {}, amount = 1): void {
    const labelValues = this.labelValues(labels);
    const key = labelValues.join(" ");
    const entry = this.entries.get(key);
    if (entry) {
      entry.value += amount;
    } else {
      this.entries.set(key, { labelValues, value: amount });
    }
  }

  protected samples(): string[] {
    return [...this.entries.values()].map(
      (entry) =>
        `${this.name}${renderLabels(this.labelNames, entry.labelValues)} ${entry.value}`
    );
  }
}

export class Gauge extends Metric {
  readonly type = "gauge";
  private readonly entries = new Map<string, ScalarEntry>();

  private entry(labels: MetricLabels): ScalarEntry {
    const labelValues = this.labelValues(labels);
    const key = labelValues.join(" ");
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { labelValues, value: 0 };
      this.entries.set(key, entry);
    }
    return entry;
  }

  set(value: number, labels: MetricLabels = {}): void {
    this.entry(labels).value = value;
  }

  inc(labels: MetricLabels = {}, amount = 1): void {
    this.entry(labels).value += amount;
  }

  dec(labels: MetricLabels = {}, amount = 1): void {
    this.entry(labels).value -= amount;
  }

  protected samples(): string[] {
    return [...this.entries.values()].map(
      (entry) =>
        `${this.name}${renderLabels(this.labelNames, entry.labelValues)} ${entry.value}`
    );
  }
}

export const DEFAULT_DURATION_BUCKETS = [
  0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120,
];

type HistogramEntry = {
  labelValues: string[];
  bucketCounts: number[];
  sum: number;
  count: number;
};

export class Histogram extends Metric {
  readonly type = "histogram";
  private readonly entries = new Map<string, HistogramEntry>();
  private readonly buckets: number[];

  constructor(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets: number[] = DEFAULT_DURATION_BUCKETS
  ) {
    super(name, help, labelNames);
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(labels: MetricLabels, value: number): void {
    const labelValues = this.labelValues(labels);
    const key = labelValues.join(" ");
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        labelValues,
        bucketCounts: new Array(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.entries.set(key, entry);
    }
    entry.sum += value;
    entry.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) {
        entry.bucketCounts[i]! += 1;
      }
    }
  }

  protected samples(): string[] {
    const lines: string[] = [];
    for (const entry of this.entries.values()) {
      for (let i = 0; i < this.buckets.length; i++) {
        const labels = renderLabels(this.labelNames, entry.labelValues, [
          "le",
          String(this.buckets[i]),
        ]);
        lines.push(`${this.name}_bucket${labels} ${entry.bucketCounts[i]}`);
      }
      const infLabels = renderLabels(this.labelNames, entry.labelValues, [
        "le",
        "+Inf",
      ]);
      const baseLabels = renderLabels(this.labelNames, entry.labelValues);
      lines.push(`${this.name}_bucket${infLabels} ${entry.count}`);
      lines.push(`${this.name}_sum${baseLabels} ${entry.sum}`);
      lines.push(`${this.name}_count${baseLabels} ${entry.count}`);
    }
    return lines;
  }
}

class MetricsRegistry {
  private readonly metrics: Metric[] = [];

  register<T extends Metric>(metric: T): T {
    this.metrics.push(metric);
    return metric;
  }

  render(): string {
    return this.metrics.map((metric) => metric.render()).join("\n") + "\n";
  }
}

export const registry = new MetricsRegistry();
