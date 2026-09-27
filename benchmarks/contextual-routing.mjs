const agents = [
  {
    id: 'generalist',
    cost: 0.35,
    successByTask: {
      migration: 0.82,
      authorization: 0.68,
      frontend: 0.91,
      concurrency: 0.69,
    },
  },
  {
    id: 'systems',
    cost: 0.62,
    successByTask: {
      migration: 0.94,
      authorization: 0.86,
      frontend: 0.66,
      concurrency: 0.95,
    },
  },
  {
    id: 'security',
    cost: 0.74,
    successByTask: {
      migration: 0.81,
      authorization: 0.97,
      frontend: 0.58,
      concurrency: 0.8,
    },
  },
];

const scenarios = [
  { taskClass: 'authorization', trials: 160 },
  { taskClass: 'migration', trials: 160 },
  { taskClass: 'concurrency', trials: 160 },
  { taskClass: 'frontend', trials: 160 },
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function betaPosterior(successes, failures) {
  const alpha = 2 + successes;
  const beta = 2 + failures;
  const total = alpha + beta;
  const mean = alpha / total;
  const variance = (alpha * beta) / (total * total * (total + 1));
  const sd = Math.sqrt(variance);
  return {
    mean,
    conservative: Math.max(0, mean - 1.64 * sd),
  };
}

const random = seededRandom(20260927);
const trainingTrialsPerAgentContext = 40;
const history = new Map();

for (const scenario of scenarios) {
  for (const agent of agents) {
    let successes = 0;
    let failures = 0;

    for (let i = 0; i < trainingTrialsPerAgentContext; i += 1) {
      const passed = random() < agent.successByTask[scenario.taskClass];
      if (passed) successes += 1;
      else failures += 1;
    }

    history.set(
      agent.id + '::' + scenario.taskClass,
      betaPosterior(successes, failures),
    );
  }
}

const genericBest = [...agents]
  .map((agent) => ({
    agent,
    mean:
      Object.values(agent.successByTask).reduce((sum, p) => sum + p, 0) /
      Object.values(agent.successByTask).length,
  }))
  .sort((a, b) => b.mean - a.mean)[0].agent;

let baselineSuccesses = 0;
let contextualSuccesses = 0;
let oracleSuccesses = 0;
let baselineCost = 0;
let contextualCost = 0;
let total = 0;

const routes = [];

for (const scenario of scenarios) {
  const contextual = [...agents]
    .map((agent) => ({
      agent,
      score: history.get(agent.id + '::' + scenario.taskClass).conservative,
    }))
    .sort((a, b) => b.score - a.score)[0];

  const oracle = [...agents].sort(
    (a, b) =>
      b.successByTask[scenario.taskClass] -
      a.successByTask[scenario.taskClass],
  )[0];

  routes.push({
    taskClass: scenario.taskClass,
    staticAgent: genericBest.id,
    contextualAgent: contextual.agent.id,
    oracleAgent: oracle.id,
    contextualConservativeTrust: Number(contextual.score.toFixed(4)),
  });

  for (let i = 0; i < scenario.trials; i += 1) {
    const baselineDraw = random();
    const contextualDraw = random();
    const oracleDraw = random();

    if (baselineDraw < genericBest.successByTask[scenario.taskClass]) {
      baselineSuccesses += 1;
    }
    if (
      contextualDraw <
      contextual.agent.successByTask[scenario.taskClass]
    ) {
      contextualSuccesses += 1;
    }
    if (oracleDraw < oracle.successByTask[scenario.taskClass]) {
      oracleSuccesses += 1;
    }

    baselineCost += genericBest.cost;
    contextualCost += contextual.agent.cost;
    total += 1;
  }
}

const result = {
  benchmark: 'archeagent-contextual-routing-synthetic-v1',
  qualification:
    'Deterministic synthetic benchmark. It validates routing mechanics only and is not evidence of real model performance.',
  seed: 20260927,
  trainingTrialsPerAgentContext,
  heldOutTrials: total,
  routes,
  staticBaseline: {
    agent: genericBest.id,
    successRate: baselineSuccesses / total,
    averageCostUsd: baselineCost / total,
  },
  contextualRouter: {
    successRate: contextualSuccesses / total,
    averageCostUsd: contextualCost / total,
  },
  oracleUpperBound: {
    successRate: oracleSuccesses / total,
  },
  delta: {
    successRate:
      contextualSuccesses / total - baselineSuccesses / total,
    averageCostUsd:
      contextualCost / total - baselineCost / total,
  },
};

console.log(JSON.stringify(result, null, 2));
