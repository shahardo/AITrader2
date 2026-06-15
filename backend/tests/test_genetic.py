# test_genetic.py — tests for the GA engine (app/strategy/genetic.py): small,
# deterministic runs verifying the hall-of-fame, fitness history, and gene bounds.

from app.strategy.evolved import GENE_BOUNDS
from app.strategy.genetic import EvolutionConfig, EvolutionResult, run_evolution
from tests.test_strategy_eval import _seed_universe


def _small_config(**overrides) -> EvolutionConfig:
    return EvolutionConfig(population_size=8, generations=3, seed=42, max_symbols=3, **overrides)


def test_run_evolution_returns_bounded_candidates(db_session):
    _seed_universe(db_session, n_symbols=3)
    result = run_evolution(db_session, _small_config())

    assert isinstance(result, EvolutionResult)
    assert 1 <= len(result.candidates) <= 5
    for candidate in result.candidates:
        for key, value in candidate.gene.items():
            lo, hi = GENE_BOUNDS[key]
            assert lo <= value <= hi
        assert "sharpe" in candidate.train_metrics
        assert "sharpe" in candidate.test_metrics
        assert candidate.equity_curve
        assert isinstance(candidate.test_trades, list)


def test_run_evolution_candidates_sorted_by_train_fitness(db_session):
    _seed_universe(db_session, n_symbols=3)
    result = run_evolution(db_session, _small_config())

    fitnesses = [m["sharpe"] - 1.0 * abs(m["max_drawdown"]) for m in
                 (c.train_metrics for c in result.candidates)]
    assert fitnesses == sorted(fitnesses, reverse=True)
    assert [c.rank for c in result.candidates] == list(range(1, len(result.candidates) + 1))


def test_fitness_history_length_and_monotonic_best(db_session):
    _seed_universe(db_session, n_symbols=3)
    config = _small_config()
    result = run_evolution(db_session, config)

    assert len(result.fitness_history) == config.generations
    bests = [h["best"] for h in result.fitness_history]
    # Elitism guarantees the best fitness never decreases across generations.
    assert all(b2 >= b1 - 1e-9 for b1, b2 in zip(bests, bests[1:]))
    for entry in result.fitness_history:
        assert set(entry) == {"generation", "best", "avg"}


def test_run_evolution_is_deterministic_with_seed(db_session):
    _seed_universe(db_session, n_symbols=3)
    config = _small_config()
    result1 = run_evolution(db_session, config)
    result2 = run_evolution(db_session, config)

    genes1 = [c.gene for c in result1.candidates]
    genes2 = [c.gene for c in result2.candidates]
    assert genes1 == genes2


def test_progress_callback_invoked_per_generation(db_session):
    _seed_universe(db_session, n_symbols=3)
    config = _small_config()
    calls = []

    def progress_cb(generation, fitness_history):
        calls.append((generation, len(fitness_history)))

    run_evolution(db_session, config, progress_cb=progress_cb)
    assert calls == [(g, g + 1) for g in range(config.generations)]


def test_on_individual_progress_invoked_per_individual(db_session):
    _seed_universe(db_session, n_symbols=3)
    config = _small_config()
    calls = []

    def on_individual_progress(generation, evaluated, population_size):
        calls.append((generation, evaluated, population_size))

    run_evolution(db_session, config, on_individual_progress=on_individual_progress)
    assert calls == [
        (g, i, config.population_size)
        for g in range(config.generations)
        for i in range(1, config.population_size + 1)
    ]


def test_on_individual_progress_can_stop_evolution_early(db_session):
    _seed_universe(db_session, n_symbols=3)
    config = _small_config()
    calls = []

    def on_individual_progress(generation, evaluated, population_size):
        calls.append((generation, evaluated))
        return generation == 0 and evaluated == 3

    result = run_evolution(db_session, config, on_individual_progress=on_individual_progress)
    assert result.cancelled is True
    assert result.candidates == []
    assert result.fitness_history == []
    assert calls == [(0, 1), (0, 2), (0, 3)]


def test_progress_cb_can_stop_evolution_after_a_generation(db_session):
    _seed_universe(db_session, n_symbols=3)
    config = _small_config()

    def progress_cb(generation, fitness_history):
        return generation == 0

    result = run_evolution(db_session, config, progress_cb=progress_cb)
    assert result.cancelled is True
    assert result.candidates == []
    assert len(result.fitness_history) == 1
