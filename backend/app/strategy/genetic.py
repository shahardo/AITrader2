# genetic.py — genetic algorithm that evolves the "evolved" strategy's gene
# (app/strategy/evolved.py): tournament selection + uniform crossover +
# gaussian mutation over the train window, keeping the top 5 genes ever seen
# ("hall of fame") and validating each on the held-out test window.

import random
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

from app.models.strategy import BacktestTrade, StrategyEvolutionRun, StrategyRun
from app.strategy.backtest import SimTrade, run_backtest
from app.strategy.evaluator import (
    ensure_strategy_rows,
    evaluation_windows,
    load_features_for_window,
)
from app.strategy.evolved import GENE_BOUNDS, EvolvedStrategy, describe_gene

TOP_N_CANDIDATES = 5


@dataclass
class EvolutionConfig:
    """GA hyperparameters and run scope.

    Attributes:
        population_size: Number of genes per generation.
        generations: Number of generations to evolve.
        mutation_rate: Per-gene-component probability of mutation.
        mutation_sigma: Gaussian mutation stddev, as a fraction of each
            component's bound range.
        crossover_rate: Probability that crossover (vs. cloning) produces a child.
        elite_count: Number of top genes carried unchanged each generation.
        tournament_size: Number of individuals sampled per tournament selection.
        risk_weight: Drawdown penalty weight in the fitness function.
        max_symbols: Cap on simulated symbols (bounds per-backtest cost).
        symbols: Universe subset (defaults to all active instruments).
        seed: RNG seed for reproducibility.
        initial_capital: Simulated starting cash for each backtest.
    """

    population_size: int = 50
    generations: int = 30
    mutation_rate: float = 0.2
    mutation_sigma: float = 0.15
    crossover_rate: float = 0.7
    elite_count: int = 2
    tournament_size: int = 3
    risk_weight: float = 1.0
    max_symbols: int = 25
    symbols: list[str] | None = None
    seed: int | None = None
    initial_capital: float = 100_000.0


@dataclass
class EvolutionCandidate:
    """One of the top genes from a run, validated on train and test windows."""

    rank: int
    gene: dict[str, float]
    train_metrics: dict
    test_metrics: dict
    equity_curve: list[tuple[date, float]]
    test_trades: list[SimTrade] = field(default_factory=list)


@dataclass
class EvolutionResult:
    """Output of one GA run: the top candidates plus fitness history."""

    candidates: list[EvolutionCandidate]
    fitness_history: list[dict]
    train_start: date
    train_end: date
    test_start: date
    test_end: date
    cancelled: bool = False


def _random_gene(rng: random.Random) -> dict[str, float]:
    """Sample a gene uniformly within GENE_BOUNDS.

    Args:
        rng: Random source.

    Returns:
        dict[str, float]: A new gene.
    """
    return {key: rng.uniform(lo, hi) for key, (lo, hi) in GENE_BOUNDS.items()}


def _tournament_select(
    population: list[dict[str, float]], fitnesses: list[float], rng: random.Random, k: int
) -> dict[str, float]:
    """Pick the fittest of k random individuals.

    Args:
        population: Current generation's genes.
        fitnesses: Fitness per gene (same order as population).
        rng: Random source.
        k: Tournament size.

    Returns:
        dict[str, float]: The selected gene (not a copy).
    """
    best_idx = rng.randrange(len(population))
    for _ in range(k - 1):
        idx = rng.randrange(len(population))
        if fitnesses[idx] > fitnesses[best_idx]:
            best_idx = idx
    return population[best_idx]


def _crossover(
    parent1: dict[str, float], parent2: dict[str, float], rng: random.Random, rate: float
) -> dict[str, float]:
    """Uniform crossover of two genes.

    Args:
        parent1: First parent gene.
        parent2: Second parent gene.
        rng: Random source.
        rate: Probability of producing a blended child (vs. cloning parent1).

    Returns:
        dict[str, float]: A new gene.
    """
    if rng.random() >= rate:
        return dict(parent1)
    return {key: (parent1[key] if rng.random() < 0.5 else parent2[key]) for key in GENE_BOUNDS}


def _mutate(
    gene: dict[str, float], rng: random.Random, rate: float, sigma: float
) -> dict[str, float]:
    """Gaussian-perturb a gene's components, clipped to GENE_BOUNDS.

    Args:
        gene: Gene to mutate (not modified in place).
        rng: Random source.
        rate: Per-component probability of mutation.
        sigma: Gaussian stddev as a fraction of each component's bound range.

    Returns:
        dict[str, float]: A new, possibly mutated, gene.
    """
    mutated = dict(gene)
    for key, (lo, hi) in GENE_BOUNDS.items():
        if rng.random() < rate:
            mutated[key] = max(lo, min(hi, mutated[key] + rng.gauss(0, sigma * (hi - lo))))
    return mutated


def _fitness(metrics: dict, risk_weight: float) -> float:
    """Risk-adjusted fitness used to drive selection.

    Args:
        metrics: A backtest's metrics dict (must include sharpe, max_drawdown).
        risk_weight: Drawdown penalty weight.

    Returns:
        float: sharpe - risk_weight * |max_drawdown|.
    """
    return metrics["sharpe"] - risk_weight * abs(metrics["max_drawdown"])


def run_evolution(
    db: Session,
    config: EvolutionConfig,
    as_of: date | None = None,
    progress_cb=None,
    on_individual_progress=None,
) -> EvolutionResult:
    """Evolve the 'evolved' strategy's gene against the train window.

    Args:
        db: Database session.
        config: GA hyperparameters and run scope.
        as_of: Evaluation date (defaults to today); window is the trailing year.
        progress_cb: Optional callable(generation, fitness_history) invoked
            after each generation, for progress tracking. Return a truthy
            value to stop evolving after this generation.
        on_individual_progress: Optional callable(generation, evaluated,
            population_size) invoked after each gene in a generation is
            backtested, for finer-grained progress. Return a truthy value to
            stop evolving immediately.

    Returns:
        EvolutionResult: Up to TOP_N_CANDIDATES genes (best-first by train
        fitness), each validated on the train and test windows, plus the
        per-generation fitness history. If stopped early via progress_cb/
        on_individual_progress, `cancelled` is True and `candidates` reflects
        only the generations completed so far (possibly empty).

    Raises:
        ValueError: If no instruments have enough history to backtest.
    """
    as_of = as_of or date.today()
    train_start, train_end, test_start, test_end = evaluation_windows(as_of)

    features = load_features_for_window(db, config.symbols, config.max_symbols)
    if not features:
        raise ValueError("No instruments with enough history to evolve a strategy")

    rng = random.Random(config.seed)
    population = [_random_gene(rng) for _ in range(config.population_size)]
    fitness_history: list[dict] = []
    hall_of_fame: list[tuple[dict[str, float], float]] = []
    cancelled = False

    for generation in range(config.generations):
        results = []
        for i, gene in enumerate(population):
            results.append(run_backtest(EvolvedStrategy(gene), features, train_start, train_end,
                                        config.initial_capital))
            if on_individual_progress is not None and on_individual_progress(
                generation, i + 1, len(population)
            ):
                cancelled = True
                break
        if cancelled:
            break
        fitnesses = [_fitness(r.metrics, config.risk_weight) for r in results]

        hall_of_fame.extend(zip(population, fitnesses, strict=True))
        hall_of_fame.sort(key=lambda gf: gf[1], reverse=True)
        hall_of_fame = hall_of_fame[:TOP_N_CANDIDATES]

        fitness_history.append({
            "generation": generation,
            "best": max(fitnesses),
            "avg": sum(fitnesses) / len(fitnesses),
        })
        if progress_cb is not None and progress_cb(generation, fitness_history):
            cancelled = True
            break

        ranked = sorted(zip(population, fitnesses, strict=True), key=lambda gf: gf[1], reverse=True)
        next_population = [gene for gene, _ in ranked[:config.elite_count]]
        while len(next_population) < config.population_size:
            parent1 = _tournament_select(population, fitnesses, rng, config.tournament_size)
            parent2 = _tournament_select(population, fitnesses, rng, config.tournament_size)
            child = _crossover(parent1, parent2, rng, config.crossover_rate)
            child = _mutate(child, rng, config.mutation_rate, config.mutation_sigma)
            next_population.append(child)
        population = next_population

    if cancelled:
        return EvolutionResult(candidates=[], fitness_history=fitness_history,
                                train_start=train_start, train_end=train_end,
                                test_start=test_start, test_end=test_end, cancelled=True)

    candidates: list[EvolutionCandidate] = []
    for rank, (gene, _gene_fitness) in enumerate(hall_of_fame, start=1):
        train_result = run_backtest(EvolvedStrategy(gene), features, train_start, train_end,
                                    config.initial_capital)
        test_result = run_backtest(EvolvedStrategy(gene), features, test_start, test_end,
                                   config.initial_capital)
        candidates.append(EvolutionCandidate(
            rank=rank, gene=gene, train_metrics=train_result.metrics,
            test_metrics=test_result.metrics, equity_curve=test_result.equity_curve,
            test_trades=test_result.trades,
        ))

    return EvolutionResult(candidates=candidates, fitness_history=fitness_history,
                            train_start=train_start, train_end=train_end,
                            test_start=test_start, test_end=test_end)


def run_evolution_and_persist(
    db: Session,
    evolution_run: StrategyEvolutionRun,
    config: EvolutionConfig,
    as_of: date | None = None,
) -> None:
    """Run the GA and persist its outcome, updating evolution_run's status.

    On success, writes one StrategyRun (rank 1-5) plus its BacktestTrade rows
    per candidate, and updates the 'evolved' Strategy's live params/description
    from the rank-1 candidate. On failure, marks evolution_run as "failed" with
    the error message. If cancel_requested is set (before the run starts, or
    via the progress callbacks below), the run stops early and is marked
    "cancelled" without persisting any candidates. Either way, evolution_run's
    status/completed_at are set and committed.

    Args:
        db: Database session.
        evolution_run: The (already persisted) run row to update in place.
        config: GA hyperparameters and run scope.
        as_of: Evaluation date (defaults to today).
    """
    as_of = as_of or date.today()

    def cancel_requested() -> bool:
        db.refresh(evolution_run, attribute_names=["cancel_requested"])
        return evolution_run.cancel_requested

    if cancel_requested():
        evolution_run.status = "cancelled"
        evolution_run.completed_at = datetime.now(UTC)
        db.commit()
        return

    try:
        def progress_cb(generation: int, fitness_history: list[dict]) -> bool:
            evolution_run.current_generation = generation + 1
            evolution_run.generation_progress = 0.0
            evolution_run.fitness_history = fitness_history
            db.commit()
            return cancel_requested()

        def on_individual_progress(generation: int, evaluated: int, population_size: int) -> bool:
            evolution_run.generation_progress = evaluated / population_size
            db.commit()
            return cancel_requested()

        result = run_evolution(db, config, as_of=as_of, progress_cb=progress_cb,
                               on_individual_progress=on_individual_progress)

        if result.cancelled:
            evolution_run.status = "cancelled"
            evolution_run.completed_at = datetime.now(UTC)
            db.commit()
            return

        strategy_rows = ensure_strategy_rows(db)
        evolved_strategy = strategy_rows["evolved"]

        best_run_id = None
        for candidate in result.candidates:
            run = StrategyRun(
                strategy_id=evolved_strategy.id, run_date=as_of,
                train_start=result.train_start, train_end=result.train_end,
                test_start=result.test_start, test_end=result.test_end,
                chosen_params=candidate.gene, train_metrics=candidate.train_metrics,
                test_metrics=candidate.test_metrics,
                equity_curve=[[d.isoformat(), v] for d, v in candidate.equity_curve],
                rank=candidate.rank,
            )
            db.add(run)
            db.flush()
            for trade in candidate.test_trades:
                db.add(BacktestTrade(
                    strategy_run_id=run.id, symbol=trade.symbol, side=trade.side,
                    date=trade.date, price=trade.price, qty=trade.qty,
                    triggering_signals=trade.reasons, pnl=trade.pnl))
            if candidate.rank == 1:
                best_run_id = run.id
                evolved_strategy.params = candidate.gene
                evolved_strategy.description = describe_gene(candidate.gene)

        evolution_run.status = "done"
        evolution_run.strategy_run_id = best_run_id
        evolution_run.completed_at = datetime.now(UTC)
        db.commit()
    except Exception as exc:
        db.rollback()
        evolution_run.status = "failed"
        evolution_run.error_message = str(exc)[:1000]
        evolution_run.completed_at = datetime.now(UTC)
        db.commit()
