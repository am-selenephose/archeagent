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

const capabilities = [
  {
    icon: GitCompareArrows,
    title: "Parallel patch comparison",
    text: "Run multiple candidate implementations against the same acceptance contract.",
  },
  {
    icon: ShieldCheck,
    title: "Release gates, not vibes",
    text: "Tests, contracts, security, migrations, performance and evidence are first-class boundaries.",
  },
  {
    icon: Radar,
    title: "Evidence bundles",
    text: "Every decision carries the runtime proof needed to reproduce why a patch passed or failed.",
  },
  {
    icon: Layers3,
    title: "Human-owned acceptance",
    text: "Agents propose. The evaluator verifies. A human keeps final merge authority.",
  },
];

export default function Home() {
  return (
    <main>
      <nav className="nav-shell">
        <a className="brand" href="#">
          <span className="brand-mark">SP</span>
          <span>ShipProof</span>
        </a>
        <div className="nav-links">
          <a href="#console">Demo</a>
          <a href="#architecture">Architecture</a>
          <a className="nav-cta" href="#console">Run proof <ArrowRight size={15} /></a>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-badge"><Sparkles size={15} />AI-native production engineering</div>

        <h1>
          Agents can write code.
          <span>ShipProof decides if it is safe to ship.</span>
        </h1>

        <p className="hero-copy">
          A production control plane for AI-generated software. Compare competing
          patches, execute release gates, capture evidence, and produce an auditable
          merge decision.
        </p>

        <div className="hero-actions">
          <a className="primary-action" href="#console">Try the live evaluation <ArrowRight size={17} /></a>
          <a className="secondary-action" href="#architecture">See architecture</a>
        </div>

        <div className="trust-row">
          <span><BadgeCheck size={15} /> deterministic evaluator</span>
          <span><Braces size={15} /> TypeScript-first</span>
          <span><Activity size={15} /> observable by default</span>
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

      <EvaluationConsole />

      <section className="architecture-section" id="architecture">
        <div className="architecture-copy">
          <p className="eyebrow">Architecture</p>
          <h2>Velocity on one side. Verification on the other.</h2>
          <p>
            ShipProof treats model output as an untrusted proposal. Each candidate
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
        <div className="brand footer-brand"><span className="brand-mark">SP</span><span>ShipProof</span></div>
        <p>Evidence first software delivery for AI-native engineering teams.</p>
      </footer>
    </main>
  );
}
