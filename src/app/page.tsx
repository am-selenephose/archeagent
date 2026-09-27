import { readFileSync } from "node:fs";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Braces,
  GitCompareArrows,
  Layers3,
  Radar,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { EvaluationConsole } from "@/components/evaluation-console";
import { IntelligenceConsole } from "@/components/intelligence-console";
import formalReceipt from "../../formal/receipts/release-authority-summary.json";
import { assertFormalReceiptFresh } from "@/core/formal-receipt";

assertFormalReceiptFresh(formalReceipt, {
  spec: readFileSync("formal/ReleaseAuthority.tla"),
  safeConfig: readFileSync("formal/ReleaseAuthority.cfg"),
  negativeConfig: readFileSync("formal/ReleaseAuthorityUnsafe.cfg"),
});

const capabilities = [
  {
    icon: GitCompareArrows,
    title: "Contextual labor intelligence",
    text: "Route work from repository and task-specific outcome history instead of one global model leaderboard.",
  },
  {
    icon: ShieldCheck,
    title: "Proof-carrying release authority",
    text: "Short-lived Ed25519 release leases bind permission to exact code, policy, evidence and environment.",
  },
  {
    icon: Radar,
    title: "Model-checked invariants",
    text: formalReceipt.safe_model.distinct_states.toLocaleString() + " reachable release states checked with a negative-control counterexample.",
  },
  {
    icon: Layers3,
    title: "Isolated execution plane",
    text: "A Go runtime enforces bounded container execution with network-off, read-only and resource-limited defaults.",
  },
];

export default function Home() {
  return (
    <main>
      <nav className="nav-shell">
        <a className="brand" href="#">
          <span className="brand-mark">AR</span>
          <span>Archeagent</span>
        </a>
        <div className="nav-links">
          <a href="#console">Demo</a>
          <a href="#architecture">Architecture</a>
          <a className="nav-cta" href="#console">Run proof <ArrowRight size={15} /></a>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-badge"><Sparkles size={15} />Outcome-grounded agent engineering</div>

        <h1>
          Do not trust the model.
          <span>Trust the measured worker, the evidence, and the exact release state.</span>
        </h1>

        <p className="hero-copy">
          Archeagent learns which coding agents and reviewer pairs are reliable for
          each class of work, limits what authority they earn, and issues release
          permission only for an exact independently verified state.
        </p>

        <div className="hero-actions">
          <a className="primary-action" href="#console">Try the live evaluation <ArrowRight size={17} /></a>
          <a className="secondary-action" href="#architecture">See architecture</a>
        </div>

        <div className="trust-row">
          <span><BadgeCheck size={15} /> contextual trust</span>
          <span><Braces size={15} /> TypeScript + Go</span>
          <span><Activity size={15} /> TLA+ model checked</span>
        </div>
      </section>

      <section className="capability-grid">
        {capabilities.map(({ icon: Icon, title, text }) => (
          <article className="capability-card" key={title}>
            <div className="capability-icon"><Icon size={19} /></div>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <IntelligenceConsole />

      <section className="formal-receipt">
        <div>
          <p className="eyebrow">Machine-checked release authority</p>
          <h2>{formalReceipt.safe_model.distinct_states.toLocaleString()} reachable states. Zero invariant violations.</h2>
          <p>
            The safe TLA+ model completed the entire bounded state graph. A negative
            control that intentionally omitted exact base-commit fencing produced the
            expected counterexample.
          </p>
        </div>
        <div className="formal-stats">
          <span><strong>{formalReceipt.safe_model.states_generated.toLocaleString()}</strong> states generated</span>
          <span><strong>{formalReceipt.safe_model.graph_depth}</strong> graph depth</span>
          <span><strong>PASS</strong> safe model</span>
          <span className="negative-stat"><strong>CAUGHT</strong> unsafe verifier</span>
        </div>
      </section>

      <EvaluationConsole />

      <section className="architecture-section" id="architecture">
        <div className="architecture-copy">
          <p className="eyebrow">Architecture</p>
          <h2>Velocity on one side. Verification on the other.</h2>
          <p>
            Archeagent treats model output as an untrusted proposal. Each candidate
            moves through a deterministic evaluator before a release decision is
            produced.
          </p>
        </div>

        <div className="architecture-flow">
          <div className="flow-node"><span>01</span><strong>Candidate agents</strong><small>Parallel worktrees and patch manifests</small></div>
          <ArrowRight className="flow-arrow" />
          <div className="flow-node accent"><span>02</span><strong>Evidence engine</strong><small>Tests, contracts, security, migrations, perf</small></div>
          <ArrowRight className="flow-arrow" />
          <div className="flow-node"><span>03</span><strong>Human gate</strong><small>MERGE, NEEDS_WORK or REJECT with proof</small></div>
        </div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">AR</span><span>Archeagent</span></div>
        <p>Evidence first software delivery for AI-native engineering teams.</p>
      </footer>
    </main>
  );
}
