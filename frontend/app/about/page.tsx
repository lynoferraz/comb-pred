import Link from "next/link";
import AboutGraph from "../components/AboutGraph";
import {
  Network,
  TrendingUp,
  GitMerge,
  Wallet,
  CheckCircle,
  TriangleAlert,
} from "lucide-react";

export const metadata = {
  title: "About — CIM",
  description:
    "How Combinatorial Information Markets work: a junction-tree AMM for trading beliefs over interrelated events.",
};

const card = "bg-surface border border-line rounded-card p-7";

export default function AboutPage() {
  return (
    <div className="px-4 md:px-7 pt-10 pb-16 max-w-[860px] mx-auto space-y-6 animate-in">
      <div>
        <h1 className="text-[40px] font-semibold tracking-tight leading-none text-ink">
          About CIM
        </h1>
        <p className="mt-3 text-base text-ink2 max-w-[640px] leading-relaxed">
          CIM — Combinatorial Information Markets — is a prediction market for{" "}
          <em>interrelated</em> events. Instead of trading each question in
          isolation, CIM keeps one coherent probability model over all of them,
          so a forecast on one event automatically updates everything connected
          to it.
        </p>
      </div>

      {/* Disclaimer */}
      <div className="border border-no/40 bg-no-soft rounded-card p-5 flex gap-3 items-start">
        <TriangleAlert size={18} className="text-no shrink-0 mt-0.5" />
        <div className="text-[13px] text-ink leading-relaxed">
          <span className="font-semibold">This is a test version.</span> Markets
          are currently resolved by the market operator, not by decentralized
          oracles, and the deployment targets a test network. Do not use real
          funds: balances, payouts and resolutions exist for evaluation only.
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={16} className="text-accent" />
          <h2 className="text-base font-semibold text-ink">
            Forecasts, not shares
          </h2>
        </div>
        <p className="text-sm text-ink2 leading-relaxed">
          CIM uses an automated market maker in the logarithmic-scoring family:
          you trade by <em>moving the market&apos;s probability</em> toward your
          belief. If you move a probability from 30% to 40% and the outcome
          occurs, you profit in proportion to how much information your report
          added; if it doesn&apos;t, you lose at most what the move cost you.
          The market parameter <span className="font-mono">b</span> sets the
          depth: larger <span className="font-mono">b</span> means moving the
          price is more expensive and the market absorbs more volume per
          percentage point.
        </p>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <Network size={16} className="text-accent" />
          <h2 className="text-base font-semibold text-ink">
            Combinatorial markets
          </h2>
        </div>
        <p className="text-sm text-ink2 leading-relaxed">
          Real-world questions are rarely independent — inflation influences
          interest rates, a team winning its group shapes the knockout bracket.
          Following Robin Hanson&apos;s{" "}
          <a
            href="https://mason.gmu.edu/~rhanson/combobet.pdf"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink"
          >
            Combinatorial Information Market
          </a>{" "}
          design, CIM models all variables jointly, which unlocks two things
          ordinary prediction markets can&apos;t do:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-ink2 leading-relaxed list-disc pl-5">
          <li>
            <span className="font-medium text-ink">Conditional forecasts.</span>{" "}
            Add evidence — &ldquo;suppose inflation stays above 4%&rdquo; — and
            trade the probability of another event <em>under that scenario</em>.
          </li>
          <li>
            <span className="font-medium text-ink">Automatic propagation.</span>{" "}
            A report on one variable consistently updates the probabilities of
            every related variable, keeping the whole model coherent.
          </li>
        </ul>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <GitMerge size={16} className="text-accent" />
          <h2 className="text-base font-semibold text-ink">
            The junction tree under the hood
          </h2>
        </div>
        <p className="text-sm text-ink2 leading-relaxed">
          Tracking a full joint distribution over dozens of variables is
          exponentially expensive. CIM instead maintains a{" "}
          <em>junction tree</em>: related variables are grouped into cliques,
          and cliques are linked by the variables they share (their separators).
          Belief propagation over this tree computes exact probabilities while
          only ever multiplying small local tables. The graph below shows the
          live structure of this market — each node is a clique, each edge label
          a separator, and dashed edges connect independent clusters. The whole
          engine runs deterministically inside a{" "}
          <a
            href="https://cartesi.io"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink"
          >
            Cartesi rollup
          </a>
          , so every probability update is verifiable on-chain.
        </p>
        <AboutGraph />
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <Wallet size={16} className="text-accent" />
          <h2 className="text-base font-semibold text-ink">
            The trading lifecycle
          </h2>
        </div>
        <ol className="space-y-2.5 text-sm text-ink2 leading-relaxed list-decimal pl-5">
          <li>
            <span className="font-medium text-ink">Deposit.</span> Move ETH into
            the market from the header — it becomes your in-app balance.
          </li>
          <li>
            <span className="font-medium text-ink">Forecast.</span> Pick a
            market, optionally add evidence, and move the probability toward
            your belief. Your{" "}
            <Link href="/dashboard" className="underline hover:text-ink">
              Portfolio
            </Link>{" "}
            tracks the expected value of your positions across every joint
            outcome.
          </li>
          <li>
            <span className="font-medium text-ink">Resolution.</span> When the
            outcome is known, the variable is resolved
            <span className="text-ink3">
              {" "}
              (by the operator in this test version)
            </span>{" "}
            and payouts settle into traders&apos; balances.
          </li>
          <li>
            <span className="font-medium text-ink">Withdraw.</span> Request a
            withdrawal from the header, then claim the voucher from your
            Portfolio once its proof settles on the base layer.
          </li>
        </ol>
      </div>

      <div className="flex items-center gap-2 text-sm text-ink2">
        <CheckCircle size={15} className="text-accent" />
        Ready to try it?{" "}
        <Link href="/" className="font-semibold text-ink underline">
          Browse the markets
        </Link>
      </div>
    </div>
  );
}
