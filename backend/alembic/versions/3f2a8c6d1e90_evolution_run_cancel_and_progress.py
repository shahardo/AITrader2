"""strategy evolution run cancel flag and finer-grained progress

Revision ID: 3f2a8c6d1e90
Revises: 7c1f4a2e9b3d
Create Date: 2026-06-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3f2a8c6d1e90'
down_revision: Union[str, Sequence[str], None] = '7c1f4a2e9b3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('strategy_evolution_runs',
                   sa.Column('cancel_requested', sa.Boolean(), nullable=False,
                             server_default=sa.false()))
    op.add_column('strategy_evolution_runs',
                   sa.Column('generation_progress', sa.Float(), nullable=False,
                             server_default='0'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('strategy_evolution_runs', 'generation_progress')
    op.drop_column('strategy_evolution_runs', 'cancel_requested')
