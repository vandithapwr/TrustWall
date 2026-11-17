import fs from "fs";
import path from "path";
import { mlEngine } from "./mlEngine.ts";
import type {
  AlertRecord,
  AuditEventRecord,
  DriftEventRecord,
  LearningSampleRecord,
  ModelVersionRecord,
  TrafficLogRecord,
} from "./types.ts";

export interface StoreState {
  nextTrafficId: number;
  nextAlertId: number;
  nextAuditId: number;
  nextModelId: number;
  nextDriftId: number;
  trafficLogs: TrafficLogRecord[];
  alerts: AlertRecord[];
  learningSamples: LearningSampleRecord[];
  auditEvents: AuditEventRecord[];
  modelVersions: ModelVersionRecord[];
  driftEvents: DriftEventRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "trustwall-store.json");

function createInitialState(): StoreState {
  const baseline = mlEngine.getActiveBundle();
  return {
    nextTrafficId: 1,
    nextAlertId: 1,
    nextAuditId: 1,
    nextModelId: 2,
    nextDriftId: 1,
    trafficLogs: [],
    alerts: [],
    learningSamples: [],
    auditEvents: [
      {
        id: 1,
        actor: "system",
        action: "MODEL_INIT",
        entity_type: "model_version",
        entity_id: baseline.version,
        timestamp: new Date().toISOString(),
        details: {
          dataset: "1,200 synthetic samples (60/20/20 split, seed=42)",
          validation_metrics: baseline.valMetrics,
        },
      },
    ],
    modelVersions: [
      {
        id: 1,
        version: baseline.version,
        status: "ACTIVE",
        created_at: new Date().toISOString(),
        metrics: baseline.valMetrics,
        parent_version: null,
        approved_samples_used: 0,
      },
    ],
    driftEvents: [],
  };
}

class PersistentStore {
  private state: StoreState;

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STORE_PATH)) {
      try {
        const raw = fs.readFileSync(STORE_PATH, "utf-8");
        this.state = JSON.parse(raw) as StoreState;
        const activeModel = this.state.modelVersions.find((m) => m.status === "ACTIVE");
        if (activeModel) {
          mlEngine.setActiveVersion(activeModel.version);
        }
        return;
      } catch {
        // Fall through to clean initialization if corrupted
      }
    }
    this.state = createInitialState();
    this.persist();
  }

  get data(): StoreState {
    return this.state;
  }

  persist(): void {
    const tmp = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf-8");
    fs.renameSync(tmp, STORE_PATH);
  }

  resetAll(): void {
    this.state = createInitialState();
    mlEngine.trainBaseline();
    this.persist();
  }
}

export const store = new PersistentStore();
