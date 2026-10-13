import { readFileSync } from "node:fs";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  GitCompareArrows,
  Layers3,
  Radar,
  ShieldCheck,
} from "lucide-react";
import { LifecycleConsole } from "@/components/lifecycle-console";
import { ThemeSwitch } from "@/components/theme-switch";
import formalReceipt from "../../formal/receipts/release-authority-summary.json";
import { assertFormalReceiptFresh } from "@/core/formal-receipt";
import { formatOperationalNumber as number } from "@/lib/ui-format";

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
    text: number(formalReceipt.safe_model.distinct_states, "count") + " reachable release states checked with a negative-control counterexample.",
  },
  {
    icon: Layers3,
    title: "Isolated execution plane",
    text: "A Go runtime enforces bounded container execution with network-off, read-only and resource-limited defaults.",
  },
];

export default function Home() {
  return (
    <main id="workspace" className="app-workspace">
      <a className="skip-link" href="#console">Skip to fixture evaluation</a>
      <nav className="nav-shell" aria-label="Primary">
        <a className="brand" href="#workspace" aria-label="Archeagent home">
          <span className="brand-mark" aria-hidden="true"><span>A</span></span>
          <span className="brand-wordmark">ARCHEAGENT<span className="wordmark-dot">.</span></span>
        </a>
        <div className="nav-links">
          <a href="#console">Fixture evaluation</a>
          <a href="#formal-model">Formal model</a>
          <a href="#architecture">Architecture</a>
          <ThemeSwitch />
        </div>
      </nav>

      <section className="hero workbench-hero" aria-labelledby="workspace-heading">
        <div className="hero-copy-column">
          <p className="eyebrow">Private local workspace · Archeagent</p>
          <h1 id="workspace-heading">EVIDENCE,<br /><em>IN VIEW.</em></h1>
          <p className="hero-copy">
            Compare candidate patches and follow the evidence behind each reported verdict.
            The fixture workbench keeps selection, policy results and release authority distinct.
          </p>
          <div className="hero-actions">
            <a className="secondary-action" href="#console">Open fixture evaluation <ArrowRight size={17} aria-hidden="true" /></a>
          </div>
          <div className="trust-row">
            <span><BadgeCheck size={15} aria-hidden="true" /> Reported fixture signals</span>
            <span><Activity size={15} aria-hidden="true" /> Read-only inspection</span>
          </div>
        </div>
        <div className="hero-material" aria-hidden="true">
          <span className="material-wave material-wave-one" />
          <span className="material-wave material-wave-two" />
          <span className="material-wave material-wave-three" />
          <div className="hero-art-caption">
            <span className="hero-art-index">01 / ARCHITECTURE OF TRUST</span>
            <span className="hero-art-rule" />
            <span>Nothing accepted without evidence.</span>
          </div>
        </div>
      </section>

      <LifecycleConsole />

      <section className="capability-section" aria-labelledby="capabilities-heading">
        <div className="section-intro">
          <span className="section-kicker">THE ARCHITECTURE</span>
          <h2 id="capabilities-heading">CONFIDENCE, <em>EARNED.</em></h2>
          <p>Four disciplines. One continuous proof chain.</p>
        </div>
        <div className="capability-grid">
          {capabilities.map(({ icon: Icon, title, text }, index) => (
            <article className="capability-card" key={title}>
              <div className="capability-card-top">
                <div className="capability-icon"><Icon size={19} aria-hidden="true" /></div>
                <span className="capability-number tabular-nums">0{index + 1} / 04</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="formal-receipt" id="formal-model" aria-labelledby="formal-model-heading">
        <div>
          <p className="eyebrow">Separate evidence · bounded formal model</p>
          <h2 id="formal-model-heading" className="display-heading">Bounded proof.</h2>
          <p>
            The safe TLA+ model completed the entire bounded state graph. A negative
            control that intentionally omitted exact base-commit fencing produced the
            expected counterexample. These statistics describe the formal model receipt;
            they do not attest fixture execution or authorize a release.
          </p>
        </div>
        <dl className="formal-stats">
          <div><dt>Reachable states</dt><dd className="tabular-nums">{number(formalReceipt.safe_model.distinct_states, "count")}</dd></div>
          <div><dt>States generated</dt><dd className="tabular-nums">{number(formalReceipt.safe_model.states_generated, "count")}</dd></div>
          <div><dt>Graph depth</dt><dd className="tabular-nums">{number(formalReceipt.safe_model.graph_depth, "count")}</dd></div>
          <div><dt>Safe model</dt><dd>PASS</dd></div>
          <div className="negative-stat"><dt>Unsafe control</dt><dd>CAUGHT</dd></div>
        </dl>
      </section>


      <section className="architecture-section" id="architecture" aria-labelledby="architecture-heading">
        <div className="architecture-copy">
          <p className="eyebrow">Architecture</p>
          <h2 id="architecture-heading">The engineering loop.</h2>
          <p>
            Routing, review, execution, evidence, release authority and production
            attribution form one engineering loop. The lifecycle fixture illustrates
            these mechanics with deterministic example data.
          </p>
        </div>

        <div className="architecture-flow">
          <div className="flow-node"><span>01</span><strong>Learned team</strong><small>Success probability, utility and reviewer complement</small></div>
          <ArrowRight className="flow-arrow" aria-hidden="true" />
          <div className="flow-node accent"><span>02</span><strong>Proof chain</strong><small>Execution, evidence, policy, formal checks and signed lease</small></div>
          <ArrowRight className="flow-arrow" aria-hidden="true" />
          <div className="flow-node"><span>03</span><strong>Production learning</strong><small>Evidence-derived attribution mutates contextual trust</small></div>
        </div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark"><span>A</span></span><span className="brand-wordmark">ARCHEAGENT<span className="wordmark-dot">.</span></span></div>
        <p>Evidence first software delivery for AI-native engineering teams.</p>
      </footer>
    </main>
  );
}
