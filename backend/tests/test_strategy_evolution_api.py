# test_strategy_evolution_api.py — tests for the manual GA-evolution trigger
# (POST /strategies/evolve, GET /strategy-evolution-runs) and the persistence
# helper run_evolution_and_persist (5 ranked StrategyRun candidates + trades).

from datetime import date
from unittest.mock import patch

from app.models.strategy import StrategyEvolutionRun, StrategyRun
from app.strategy.evaluator import ensure_strategy_rows
from app.strategy.genetic import EvolutionConfig, run_evolution_and_persist
from tests.test_strategy_eval import _seed_universe


def test_evolve_endpoint_creates_pending_run_and_dispatches_task(client, auth_headers):
    with patch("app.api.strategies.evolve_strategy_task.delay") as mock_delay:
        resp = client.post("/api/v1/strategies/evolve", headers=auth_headers,
                           json={"population_size": 12, "generations": 5, "max_symbols": 5})
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "pending"
    assert body["triggered_by"] == "manual"
    assert body["population_size"] == 12
    assert body["generations"] == 5
    assert body["max_symbols"] == 5
    assert body["current_generation"] == 0
    mock_delay.assert_called_once()
    run_id, options = mock_delay.call_args[0]
    assert run_id == body["id"]
    assert options["population_size"] == 12


def test_get_and_list_evolution_runs(client, auth_headers, db_session):
    run = StrategyEvolutionRun(status="running", triggered_by="manual",
                               population_size=10, generations=5, current_generation=2,
                               fitness_history=[{"generation": 0, "best": 0.1, "avg": 0.0}])
    db_session.add(run)
    db_session.commit()

    resp = client.get(f"/api/v1/strategy-evolution-runs/{run.id}", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["current_generation"] == 2
    assert body["fitness_history"][0]["best"] == 0.1

    listing = client.get("/api/v1/strategy-evolution-runs", headers=auth_headers).json()
    assert any(r["id"] == run.id for r in listing)

    missing = client.get("/api/v1/strategy-evolution-runs/999999", headers=auth_headers)
    assert missing.status_code == 404


def test_run_evolution_and_persist_creates_five_ranked_runs(db_session):
    _seed_universe(db_session, n_symbols=3)
    strategy_rows = ensure_strategy_rows(db_session)
    evolved = strategy_rows["evolved"]
    original_params = dict(evolved.params)

    evo_run = StrategyEvolutionRun(status="running", triggered_by="manual",
                                   population_size=8, generations=2,
                                   risk_weight=1.0, max_symbols=3)
    db_session.add(evo_run)
    db_session.commit()

    config = EvolutionConfig(population_size=8, generations=2, seed=7, max_symbols=3)
    run_evolution_and_persist(db_session, evo_run, config, as_of=date.today())

    assert evo_run.status == "done"
    assert evo_run.strategy_run_id is not None
    assert evo_run.completed_at is not None

    runs = db_session.query(StrategyRun).filter(
        StrategyRun.strategy_id == evolved.id, StrategyRun.rank > 0).all()
    assert len(runs) <= 5
    assert len(runs) >= 1
    ranks = sorted(r.rank for r in runs)
    assert ranks == list(range(1, len(runs) + 1))
    same_run_date = {r.run_date for r in runs}
    assert same_run_date == {date.today()}

    rank1 = next(r for r in runs if r.rank == 1)
    assert rank1.id == evo_run.strategy_run_id

    db_session.refresh(evolved)
    assert evolved.params != original_params
    assert evolved.params == rank1.chosen_params
    assert evolved.description


def test_run_evolution_and_persist_marks_failure(db_session):
    evo_run = StrategyEvolutionRun(status="running", triggered_by="manual",
                                   population_size=8, generations=2,
                                   risk_weight=1.0, max_symbols=3)
    db_session.add(evo_run)
    db_session.commit()

    # No instruments seeded -> load_features_for_window returns {} -> ValueError.
    config = EvolutionConfig(population_size=8, generations=2, seed=7, max_symbols=3)
    run_evolution_and_persist(db_session, evo_run, config, as_of=date.today())

    assert evo_run.status == "failed"
    assert evo_run.error_message
    assert evo_run.completed_at is not None
