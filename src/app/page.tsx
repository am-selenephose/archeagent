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
} from "lucide-react";
import { LifecycleConsole } from "@/components/lifecycle-console";
import { ThemeSwitch } from "@/components/theme-switch";
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
      <nav className="nav-shell" aria-label="Primary">
        <a className="brand" href="#" aria-label="Archeagent home">
          <span className="brand-mark" aria-hidden="true"><span>A</span></span>
          <span className="brand-wordmark">ARCHEAGENT<span className="wordmark-dot">.</span></span>
        </a>
        <div className="nav-links">
          <a href="#console">The console</a>
          <a href="#architecture">Architecture</a>
          <a className="nav-cta" href="#console">Explore proof <ArrowRight size={15} /></a>
          <ThemeSwitch />
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy-column">
          <div className="hero-badge"><span className="badge-sparkle" aria-hidden="true">✦</span> THE ART OF VERIFIED INTELLIGENCE</div>
          <p className="hero-edition">AGENT ENGINEERING / ISSUE 001</p>
          <h1>INTELLIGENCE,<br /><em>WITH INTEGRITY.</em></h1>
          <p className="hero-copy">
            Beautifully orchestrated work deserves evidence as rigorous as the
            intelligence behind it. Archeagent measures agents, verifies outcomes,
            and keeps release authority tied to exact, proven states.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#console">Explore the evaluation <ArrowRight size={17} /></a>
            <a className="secondary-action" href="#architecture">Our architecture <ArrowRight size={15} /></a>
          </div>
          <div className="trust-row">
            <span><BadgeCheck size={15} /> Evidence before assertion</span>
            <span><Braces size={15} /> TypeScript + Go</span>
            <span><Activity size={15} /> Model-checked policy</span>
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
                <div className="capability-icon"><Icon size={19} /></div>
                <span className="capability-number">0{index + 1} / 04</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <LifecycleConsole />

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


      <section className="architecture-section" id="architecture">
        <div className="architecture-copy">
          <p className="eyebrow">Architecture</p>
          <h2>The workforce learns from what survives production.</h2>
          <p>
            Routing, review, execution, evidence, release authority and production
            attribution are one closed loop. Every accepted outcome becomes evidence
            for the next engineering decision.
          </p>
        </div>

        <div className="architecture-flow">
          <div className="flow-node"><span>01</span><strong>Learned team</strong><small>Success probability, utility and reviewer complement</small></div>
          <ArrowRight className="flow-arrow" />
          <div className="flow-node accent"><span>02</span><strong>Proof chain</strong><small>Execution, evidence, policy, formal checks and signed lease</small></div>
          <ArrowRight className="flow-arrow" />
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
