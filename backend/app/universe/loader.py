# loader.py — upserts constituent lists into the instruments table, keeping
# existing rows stable (ids referenced by price bars) while refreshing metadata.

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.instrument import Instrument
from app.universe.constituents import ConstituentEntry

logger = logging.getLogger(__name__)


def upsert_universe(db: Session, entries: list[ConstituentEntry]) -> dict[str, int]:
    """Insert new instruments and refresh metadata on existing ones.

    Instruments absent from `entries` are left untouched (they may have entered
    the universe via discovery or topics, or hold user positions).

    Args:
        db: Database session (committed at the end).
        entries: Constituent entries to upsert.

    Returns:
        dict[str, int]: Counts: {"inserted": n, "updated": m}.
    """
    existing = {i.symbol: i for i in db.scalars(select(Instrument))}
    inserted = updated = 0
    for entry in entries:
        inst = existing.get(entry.symbol)
        if inst is None:
            db.add(
                Instrument(
                    symbol=entry.symbol,
                    name=entry.name,
                    exchange=entry.exchange,
                    sector=entry.sector,
                    currency=entry.currency,
                    universe_source=entry.universe_source,
                )
            )
            inserted += 1
        else:
            inst.name = entry.name or inst.name
            inst.sector = entry.sector or inst.sector
            inst.is_active = True
            updated += 1
    db.commit()
    logger.info("Universe upsert: %d inserted, %d updated", inserted, updated)
    return {"inserted": inserted, "updated": updated}
