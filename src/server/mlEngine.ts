import {
  FEATURE_NAMES,
  computeTextSignals,
  extractFeatures,
  vectorizeFeatures,
} from "./features.ts";
import type { TrafficLabel, ValidationMetrics } from "./types.ts";

export interface DatasetSample {
  id: string;
  features: Record<string, number>;
  label: TrafficLabel;
  attack_family: string;
}

// Deterministic PRNG (Mulberry32) so dataset splits and trees are reproducible
function createRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const BENIGN_TERMS = [
  "books",
  "security",
  "keyboard",
  "usb",
  "cryptography",
  "python",
  "networking",
  "poster",
  "hardware",
  "firewall",
  "algorithms",
  "cloud",
  "linux",
  "routers",
  "monitors",
];

const NEW_BENIGN_PATHS = ["/api/v2/catalog", "/deals", "/recommendations"];

const SQLI_PAYLOADS = [
  "' OR 1=1 --",
  "admin' OR '1'='1",
  "1 UNION SELECT username, password FROM users--",
  "'; DROP TABLE users; --",
  "1' AND SLEEP(5)--",
  "' OR 1=1 /*",
  "books' UNION SELECT null, table_name FROM information_schema.tables--",
];

const XSS_PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert('xss')>",
  "<svg onload=alert(document.cookie)>",
  "javascript:alert(1)",
  "\"><script>fetch('http://example.invalid')</script>",
  "<iframe src='javascript:alert(1)'></iframe>",
];

const TRAVERSAL_CMD_PAYLOADS = [
  "../../etc/passwd",
  "..%2f..%2f..%2fetc%2fpasswd",
  "; cat /etc/passwd",
  "$(whoami)",
  "| id",
];

function makeBodyFeatures(rawBody: string): Record<string, number> {
  const sig = computeTextSignals(rawBody);
  return {
    body_length: sig.length,
    body_special_char_count: sig.special_char_count,
    body_digit_count: sig.digit_count,
    body_sqli_hits: sig.sqli_keyword_hits,
    body_xss_hits: sig.xss_keyword_hits,
    body_traversal_hits: sig.traversal_hits,
    body_cmd_hits: sig.cmd_injection_hits,
    body_quote_angle_count: sig.quote_and_angle_count,
    body_entropy: sig.entropy,
  };
}

export function generateSyntheticSplits(seed = 42): {
  train: DatasetSample[];
  validation: DatasetSample[];
  test: DatasetSample[];
} {
  const rng = createRng(seed);
  const all: DatasetSample[] = [];

  for (let i = 0; i < 1200; i++) {
    const isMalicious = rng() < 0.35;
    let record: Record<string, unknown>;
    let label: TrafficLabel;
    let attackFamily: string;

    if (!isMalicious) {
      const choice = rng();
      if (choice < 0.3) {
        record = {
          method: "GET",
          path: "/search",
          query: { q: pick(rng, BENIGN_TERMS) },
          body_features: {},
        };
      } else if (choice < 0.55) {
        record = {
          method: "GET",
          path: pick(rng, ["/products", "/api/products"]),
          query: {
            category: pick(rng, ["books", "electronics", "merch"]),
            max_price: String(20 + Math.floor(rng() * 180)),
          },
          body_features: {},
        };
      } else if (choice < 0.78) {
        const user = `user${1 + Math.floor(rng() * 500)}`;
        const rawBody = `username=${user}&password=safePass${10 + Math.floor(rng() * 89)}`;
        record = {
          method: "POST",
          path: "/login",
          query: {},
          body_features: makeBodyFeatures(rawBody),
        };
      } else if (choice < 0.9) {
        const rawBody = JSON.stringify({
          rating: 1 + Math.floor(rng() * 5),
          comment: `Great item ${pick(rng, BENIGN_TERMS)}`,
        });
        record = {
          method: "POST",
          path: "/api/feedback",
          query: {},
          body_features: makeBodyFeatures(rawBody),
        };
      } else {
        record = {
          method: "GET",
          path: pick(rng, NEW_BENIGN_PATHS),
          query: {
            sort: pick(rng, ["price", "name"]),
            page: String(1 + Math.floor(rng() * 5)),
          },
          body_features: {},
        };
      }
      label = "normal";
      attackFamily = "benign";
    } else {
      const attackType = pick(rng, ["sqli", "xss", "traversal_cmd"]);
      if (attackType === "sqli") {
        const payload = pick(rng, SQLI_PAYLOADS);
        if (rng() < 0.5) {
          record = {
            method: "POST",
            path: "/login",
            query: {},
            body_features: makeBodyFeatures(JSON.stringify({ username: payload, password: "x" })),
          };
        } else {
          record = {
            method: "GET",
            path: "/search",
            query: { q: payload },
            body_features: {},
          };
        }
      } else if (attackType === "xss") {
        const payload = pick(rng, XSS_PAYLOADS);
        if (rng() < 0.7) {
          record = {
            method: "GET",
            path: "/search",
            query: { q: payload },
            body_features: {},
          };
        } else {
          record = {
            method: "POST",
            path: "/api/feedback",
            query: {},
            body_features: makeBodyFeatures(JSON.stringify({ rating: 1, comment: payload })),
          };
        }
      } else {
        const payload = pick(rng, TRAVERSAL_CMD_PAYLOADS);
        record = {
          method: "GET",
          path: "/search",
          query: { file: payload },
          body_features: {},
        };
      }
      label = "malicious";
      attackFamily = attackType;
    }

    all.push({
      id: `syn-${String(i).padStart(5, "0")}`,
      features: extractFeatures(record),
      label,
      attack_family: attackFamily,
    });
  }

  // Deterministic Fisher-Yates shuffle
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }

  const nTrain = Math.floor(all.length * 0.6); // 720
  const nVal = Math.floor(all.length * 0.2); // 240
  return {
    train: all.slice(0, nTrain),
    validation: all.slice(nTrain, nTrain + nVal),
    test: all.slice(nTrain + nVal),
  };
}

// --- Random Forest Classifier (Decision Tree Ensemble with Gini Impurity) ---

type TreeNode =
  | { leaf: true; probMalicious: number }
  | { leaf: false; featureIdx: number; threshold: number; left: TreeNode; right: TreeNode };

function gini(y: number[], indices: number[]): number {
  if (indices.length === 0) return 0;
  let ones = 0;
  for (const idx of indices) ones += y[idx];
  const p1 = ones / indices.length;
  const p0 = 1 - p1;
  return 1 - (p0 * p0 + p1 * p1);
}

function buildTree(
  X: number[][],
  y: number[],
  indices: number[],
  depth: number,
  maxDepth: number,
  rng: () => number
): TreeNode {
  let ones = 0;
  for (const idx of indices) ones += y[idx];
  const probMalicious = indices.length ? ones / indices.length : 0;

  if (depth >= maxDepth || indices.length < 6 || ones === 0 || ones === indices.length) {
    return { leaf: true, probMalicious };
  }

  const numFeatures = FEATURE_NAMES.length;
  const mtry = Math.max(3, Math.floor(Math.sqrt(numFeatures)));
  const featurePool = Array.from({ length: numFeatures }, (_, i) => i);
  for (let i = featurePool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [featurePool[i], featurePool[j]] = [featurePool[j], featurePool[i]];
  }
  const candidateFeatures = featurePool.slice(0, mtry);

  const parentImpurity = gini(y, indices);
  let bestGain = 0;
  let bestFeature = -1;
  let bestThreshold = 0;
  let bestLeft: number[] = [];
  let bestRight: number[] = [];

  for (const fIdx of candidateFeatures) {
    const uniqueVals = Array.from(new Set(indices.map((idx) => X[idx][fIdx]))).sort((a, b) => a - b);
    if (uniqueVals.length <= 1) continue;

    // Sample up to 12 candidate thresholds for fast training
    const step = Math.max(1, Math.floor(uniqueVals.length / 12));
    for (let k = 0; k < uniqueVals.length - 1; k += step) {
      const thresh = (uniqueVals[k] + uniqueVals[k + 1]) / 2;
      const left: number[] = [];
      const right: number[] = [];
      for (const idx of indices) {
        if (X[idx][fIdx] <= thresh) left.push(idx);
        else right.push(idx);
      }
      if (left.length < 2 || right.length < 2) continue;

      const weightedGini =
        (left.length / indices.length) * gini(y, left) +
        (right.length / indices.length) * gini(y, right);
      const gain = parentImpurity - weightedGini;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = fIdx;
        bestThreshold = thresh;
        bestLeft = left;
        bestRight = right;
      }
    }
  }

  if (bestFeature === -1 || bestGain <= 1e-6) {
    return { leaf: true, probMalicious };
  }

  return {
    leaf: false,
    featureIdx: bestFeature,
    threshold: bestThreshold,
    left: buildTree(X, y, bestLeft, depth + 1, maxDepth, rng),
    right: buildTree(X, y, bestRight, depth + 1, maxDepth, rng),
  };
}

function predictTree(node: TreeNode, vec: number[]): number {
  if (node.leaf) return node.probMalicious;
  return vec[node.featureIdx] <= node.threshold
    ? predictTree(node.left, vec)
    : predictTree(node.right, vec);
}

export class RandomForestModel {
  private trees: TreeNode[] = [];

  constructor(private nEstimators = 35, private maxDepth = 9, private seed = 42) {}

  fit(X: number[][], y: number[]): void {
    const rng = createRng(this.seed);
    this.trees = [];
    const n = X.length;
    if (n === 0) return;

    for (let t = 0; t < this.nEstimators; t++) {
      const bootstrap: number[] = [];
      for (let i = 0; i < n; i++) {
        bootstrap.push(Math.floor(rng() * n));
      }
      this.trees.push(buildTree(X, y, bootstrap, 0, this.maxDepth, rng));
    }
  }

  predictMaliciousProba(vec: number[]): number {
    if (this.trees.length === 0) return 0;
    let sum = 0;
    for (const tree of this.trees) {
      sum += predictTree(tree, vec);
    }
    return sum / this.trees.length;
  }

  predict(vec: number[]): 0 | 1 {
    return this.predictMaliciousProba(vec) >= 0.5 ? 1 : 0;
  }
}

// --- Normal-Only Anomaly Detector (Z-score Mahalanobis-style + Subspace Outlier Score) ---

export class NormalAnomalyDetector {
  private means: number[] = [];
  private stds: number[] = [];
  private threshold = 2.6;

  fit(normalX: number[][]): void {
    const d = FEATURE_NAMES.length;
    this.means = new Array(d).fill(0);
    this.stds = new Array(d).fill(1);
    if (normalX.length === 0) return;

    for (const row of normalX) {
      for (let j = 0; j < d; j++) this.means[j] += row[j];
    }
    for (let j = 0; j < d; j++) this.means[j] /= normalX.length;

    const vars = new Array(d).fill(0);
    for (const row of normalX) {
      for (let j = 0; j < d; j++) {
        const diff = row[j] - this.means[j];
        vars[j] += diff * diff;
      }
    }
    for (let j = 0; j < d; j++) {
      this.stds[j] = Math.max(0.25, Math.sqrt(vars[j] / normalX.length));
    }

    // Set threshold at 95th percentile of normal training scores
    const scores = normalX.map((row) => this.score(row)).sort((a, b) => a - b);
    const idx = Math.min(scores.length - 1, Math.floor(scores.length * 0.95));
    this.threshold = Math.max(2.2, scores[idx] ?? 2.6);
  }

  score(vec: number[]): number {
    if (this.means.length === 0) return 0;
    let sumSq = 0;
    for (let j = 0; j < vec.length; j++) {
      const z = (vec[j] - this.means[j]) / this.stds[j];
      sumSq += z * z;
    }
    return Number(Math.sqrt(sumSq / vec.length).toFixed(4));
  }

  isAnomaly(vec: number[]): boolean {
    return this.score(vec) > this.threshold;
  }
}

// --- ADWIN Adaptive Window Drift Detector ---

export class AdwinDetector {
  private window: number[] = [];
  constructor(private delta = 0.002, private maxWindow = 120, private minSubwindow = 15) {}

  reset(): void {
    this.window = [];
  }

  update(value: number): { driftDetected: boolean; deltaMean: number } {
    this.window.push(value);
    if (this.window.length > this.maxWindow) {
      this.window.shift();
    }

    const n = this.window.length;
    if (n < this.minSubwindow * 2) {
      return { driftDetected: false, deltaMean: 0 };
    }

    // Search split points using Hoeffding-style adaptive bound
    let totalSum = 0;
    for (const v of this.window) totalSum += v;

    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const v of this.window) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    const range = Math.max(1, maxVal - minVal);

    let leftSum = 0;
    for (let split = this.minSubwindow; split <= n - this.minSubwindow; split++) {
      leftSum += this.window[split - 1];
      const n0 = split;
      const n1 = n - split;
      const m0 = leftSum / n0;
      const m1 = (totalSum - leftSum) / n1;
      const m = 1 / (1 / n0 + 1 / n1);
      const eps = range * Math.sqrt((1 / (2 * m)) * Math.log(4 / this.delta));
      const diff = Math.abs(m0 - m1);
      if (diff > eps) {
        // Trim older half and signal drift
        this.window = this.window.slice(split);
        return { driftDetected: true, deltaMean: Number(diff.toFixed(4)) };
      }
    }

    return { driftDetected: false, deltaMean: 0 };
  }
}

// --- Evaluation & Bundle Management ---

export function evaluateClassifier(
  clf: RandomForestModel,
  samples: DatasetSample[]
): ValidationMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (const s of samples) {
    const yTrue = s.label === "malicious" ? 1 : 0;
    const yPred = clf.predict(vectorizeFeatures(s.features));
    if (yTrue === 1 && yPred === 1) tp++;
    else if (yTrue === 0 && yPred === 1) fp++;
    else if (yTrue === 0 && yPred === 0) tn++;
    else fn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;

  return {
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    fpr: Number(fpr.toFixed(4)),
    confusion_matrix: { tn, fp, fn, tp },
  };
}

export interface TrainedModelBundle {
  version: string;
  classifier: RandomForestModel;
  anomalyDetector: NormalAnomalyDetector;
  valMetrics: ValidationMetrics;
  testMetrics: ValidationMetrics;
}

class MLEngine {
  public splits = generateSyntheticSplits(42);
  private bundles = new Map<string, TrainedModelBundle>();
  public activeVersion = "model-v1";

  private driftStreams: Record<string, AdwinDetector> = {
    unfamiliar_route_rate: new AdwinDetector(0.002),
    path_length: new AdwinDetector(0.002),
    query_param_count: new AdwinDetector(0.002),
    payload_entropy: new AdwinDetector(0.002),
  };

  constructor() {
    this.trainBaseline();
  }

  trainBaseline(): TrainedModelBundle {
    const X = this.splits.train.map((s) => vectorizeFeatures(s.features));
    const y = this.splits.train.map((s) => (s.label === "malicious" ? 1 : 0));
    const normalX = X.filter((_, idx) => y[idx] === 0);

    const clf = new RandomForestModel(35, 9, 42);
    clf.fit(X, y);

    const anomaly = new NormalAnomalyDetector();
    anomaly.fit(normalX);

    const bundle: TrainedModelBundle = {
      version: "model-v1",
      classifier: clf,
      anomalyDetector: anomaly,
      valMetrics: evaluateClassifier(clf, this.splits.validation),
      testMetrics: evaluateClassifier(clf, this.splits.test),
    };
    this.bundles.set("model-v1", bundle);
    this.activeVersion = "model-v1";
    return bundle;
  }

  getActiveBundle(): TrainedModelBundle {
    return this.bundles.get(this.activeVersion) ?? this.trainBaseline();
  }

  setActiveVersion(version: string): TrainedModelBundle {
    const bundle = this.bundles.get(version);
    if (!bundle) {
      // Re-synthesize if restored across restart
      return this.retrainVersion(version, [], false).bundle;
    }
    this.activeVersion = version;
    return bundle;
  }

  predict(requestRecord: Record<string, unknown>) {
    const bundle = this.getActiveBundle();
    const features = extractFeatures(requestRecord);
    const vec = vectorizeFeatures(features);
    const maliciousProb = bundle.classifier.predictMaliciousProba(vec);
    const normalProb = 1 - maliciousProb;

    const label: TrafficLabel = maliciousProb >= 0.5 ? "malicious" : "normal";
    const confidence = Number((label === "malicious" ? maliciousProb : normalProb).toFixed(4));
    const anomalyScore = bundle.anomalyDetector.score(vec);
    const isAnomaly = bundle.anomalyDetector.isAnomaly(vec);

    const signals: string[] = [];
    if (features.sqli_keyword_hits > 0) signals.push("sqli_pattern");
    if (features.xss_keyword_hits > 0) signals.push("xss_pattern");
    if (features.traversal_hits > 0) signals.push("path_traversal_pattern");
    if (features.cmd_injection_hits > 0) signals.push("command_pattern");
    if (features.is_known_route === 0) signals.push("unfamiliar_route");
    if (isAnomaly) signals.push("anomaly_outlier");

    return {
      label,
      confidence,
      model_version: bundle.version,
      anomaly_score: anomalyScore,
      is_anomaly: isAnomaly,
      features,
      signals: signals.length > 0 ? signals : ["classifier"],
    };
  }

  observeDrift(features: Record<string, number>): Array<{ featureName: string; signalValue: number }> {
    const values: Record<string, number> = {
      unfamiliar_route_rate: 1 - (features.is_known_route ?? 1),
      path_length: features.path_length ?? 0,
      query_param_count: features.query_param_count ?? 0,
      payload_entropy: features.payload_entropy ?? 0,
    };

    const events: Array<{ featureName: string; signalValue: number }> = [];
    for (const [featName, val] of Object.entries(values)) {
      const det = this.driftStreams[featName];
      const res = det.update(val);
      if (res.driftDetected) {
        events.push({ featureName: featName, signalValue: Number(val.toFixed(4)) });
        det.reset();
      }
    }
    return events;
  }

  retrainVersion(
    newVersion: string,
    approvedSamples: Array<{ features: Record<string, number>; label: TrafficLabel }>,
    simulateBadCandidate: boolean
  ): { bundle: TrainedModelBundle; passed: boolean; failures: string[] } {
    const combined = [
      ...this.splits.train,
      ...approvedSamples.map((s, idx) => ({
        id: `approved-${idx}`,
        features: extractFeatures(s.features),
        label: s.label,
        attack_family: "approved_feedback",
      })),
    ];

    const X = combined.map((s) => vectorizeFeatures(s.features));
    let y: number[] = combined.map((s) => (s.label === "malicious" ? 1 : 0));
    if (simulateBadCandidate) {
      y = y.map((val) => 1 - val);
    }

    const normalX = X.filter((_, idx) => y[idx] === 0);
    const clf = new RandomForestModel(35, 9, 42 + approvedSamples.length);
    clf.fit(X, y);

    const anomaly = new NormalAnomalyDetector();
    anomaly.fit(normalX.length > 10 ? normalX : X);

    const valMetrics = evaluateClassifier(clf, this.splits.validation);
    const testMetrics = evaluateClassifier(clf, this.splits.test);

    const failures: string[] = [];
    if (valMetrics.recall < 0.85) failures.push(`recall ${valMetrics.recall.toFixed(3)} < 0.85`);
    if (valMetrics.precision < 0.85) failures.push(`precision ${valMetrics.precision.toFixed(3)} < 0.85`);
    if (valMetrics.f1 < 0.85) failures.push(`f1 ${valMetrics.f1.toFixed(3)} < 0.85`);
    if (valMetrics.fpr > 0.1) failures.push(`fpr ${valMetrics.fpr.toFixed(3)} > 0.10`);

    const bundle: TrainedModelBundle = {
      version: newVersion,
      classifier: clf,
      anomalyDetector: anomaly,
      valMetrics,
      testMetrics,
    };
    this.bundles.set(newVersion, bundle);

    const passed = failures.length === 0;
    if (passed) {
      this.activeVersion = newVersion;
    }

    return { bundle, passed, failures };
  }

  runComparisonExperiment() {
    // Baseline 1: Static Rules only on held-out test split
    let b1Tp = 0,
      b1Fp = 0,
      b1Tn = 0,
      b1Fn = 0;
    for (const s of this.splits.test) {
      const yTrue = s.label === "malicious" ? 1 : 0;
      const f = s.features;
      const hit =
        (f.sqli_keyword_hits ?? 0) > 0 ||
        (f.xss_keyword_hits ?? 0) > 0 ||
        (f.traversal_hits ?? 0) > 0 ||
        (f.cmd_injection_hits ?? 0) > 0;
      const yPred = hit ? 1 : 0;
      if (yTrue === 1 && yPred === 1) b1Tp++;
      else if (yTrue === 0 && yPred === 1) b1Fp++;
      else if (yTrue === 0 && yPred === 0) b1Tn++;
      else b1Fn++;
    }
    const b1Prec = b1Tp + b1Fp > 0 ? b1Tp / (b1Tp + b1Fp) : 0;
    const b1Rec = b1Tp + b1Fn > 0 ? b1Tp / (b1Tp + b1Fn) : 0;
    const b1F1 = b1Prec + b1Rec > 0 ? (2 * b1Prec * b1Rec) / (b1Prec + b1Rec) : 0;
    const b1Fpr = b1Fp + b1Tn > 0 ? b1Fp / (b1Fp + b1Tn) : 0;

    // Baseline 2: Adaptive ML accepting unverified/poisoned samples directly (mislabelled attacks)
    const trainX = this.splits.train.map((s) => vectorizeFeatures(s.features));
    const trainY = this.splits.train.map((s) => (s.label === "malicious" ? 1 : 0));
    const attackRows = trainX.filter((_, idx) => trainY[idx] === 1).slice(0, 200);
    const poisonedLabels = new Array(attackRows.length).fill(0);

    const b2X = [...trainX, ...attackRows, ...attackRows];
    const b2Y = [...trainY, ...poisonedLabels, ...poisonedLabels];
    const b2Clf = new RandomForestModel(35, 9, 42);
    b2Clf.fit(b2X, b2Y);
    const b2Metrics = evaluateClassifier(b2Clf, this.splits.test);

    // TRUSTWALL: Quarantine rejects unverified poisoned batch; validation gate verifies active model
    const activeBundle = this.getActiveBundle();

    return {
      test_sample_count: this.splits.test.length,
      baseline_static_rules: {
        precision: Number(b1Prec.toFixed(4)),
        recall: Number(b1Rec.toFixed(4)),
        f1: Number(b1F1.toFixed(4)),
        fpr: Number(b1Fpr.toFixed(4)),
      },
      baseline_unverified_ml: b2Metrics,
      trustwall_controlled: activeBundle.testMetrics,
      trustwall_validation_gate: activeBundle.valMetrics,
      active_model_version: activeBundle.version,
    };
  }
}

export const mlEngine = new MLEngine();
